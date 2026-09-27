from app import graph
from app.entities import Entities, extract
from app.search_text import tokenize


def ask(client, question, asset="CV-12"):
    r = client.post("/api/ask", data={"asset": asset, "question": question})
    assert r.status_code == 200, r.text
    return r.json()


def test_tokenize_keeps_codes_whole_and_split():
    toks = tokenize("Fault E-42 on relay K3")
    assert {"e-42", "e42", "42", "k3"} <= set(toks)


def test_entities():
    e = extract("4.2.3 Continuity fault E-42", "")
    assert extract("If open, replace relay K3 with part 3RT2016-1BB42.").parts == {"3RT2016-1BB42"}
    assert extract("Fault E-42 on relay K3").faults == {"E-42"} and "K3" in extract("relay K3").components
    assert extract("hmi shows e42", loose=True).faults == {"E-42"}
    assert e.faults == {"E-42"}


def test_library_is_seeded_into_all_three_stores(client):
    docs = client.get("/api/documents").json()
    assert all(d["status"] == "ready" for d in docs), [(d["title"], d["error"]) for d in docs]
    manual = next(d for d in docs if d["title"] == "CV-12 Conveyor Drive Manual")
    assert manual["extractor"].startswith("docling")
    scan = next(d for d in docs if "scan" in d["title"])
    # Page 1 is a clean scan (OCR, cited with a warning); page 2 is too faded to read.
    assert scan["pages_by_status"] == {"unverified": 1, "quarantined": 1}
    s = client.get("/api/stats").json()
    assert s["qdrant"]["points"] >= s["postgres"]["chunks"] - 5  # quarantined blobs are dropped
    assert s["neo4j"]["Procedure"] > 5 and s["neo4j"]["FaultCode"] >= 4
    assert client.get("/api/health").json()["services"] == {"postgres": True, "qdrant": True, "neo4j": True}


def test_graph_links_fault_to_procedure_and_component_across_documents(client):
    hits = graph.related_chunks(Entities(faults={"E-42"}), "CV-12")
    assert any("4.2.3" in h["procedure"] for h in hits.values())
    # Multi-hop for the correction loop: K3 and K4 together only occur in the retrofit bulletin.
    both = {cid: h for cid, h in graph.related_chunks(Entities(components={"K3", "K4"}), None).items() if h["hits"] == 2}
    assert both and all(h["procedure"].startswith("2 E-42") or h["procedure"].startswith("1 What") for h in both.values())


def test_a_drawing_read_as_a_netlist_is_queryable_by_terminal(client):
    """The point of reading a schematic: a terminal is a node, not pixels in a figure."""
    graph.index_schematic(999_001, {
        "terminals": [{"ref": "X4:7", "label": "spare"}, {"ref": "K3:13", "label": ""}],
        "connections": [{"from_ref": "K3:13", "to_ref": "X4:5", "wire": "214"}]})

    shown = graph.related_chunks(Entities(terminals={"X4:7"}), None, library_wide=True)
    assert 999_001 in shown and shown[999_001]["via"] == ["X4:7"]
    # "What does X4:5 land on": the drawing of the far end of its wire is evidence too.
    assert 999_001 in graph.related_chunks(Entities(terminals={"X4:5"}), None, library_wide=True)
    # A terminal no drawing shows finds nothing, rather than the nearest drawing.
    assert graph.related_chunks(Entities(terminals={"X9:1"}), None, library_wide=True) == {}


def test_answer_is_warning_first_and_cites_the_page(client):
    a = ask(client, "Conveyor stopped with fault E-42, what do I check?")
    assert a["confidence"] == "verified"
    assert a["warnings"], "lock-out warning must be shown"
    assert "Lock out" in a["warnings"][0]["text"]
    texts = [s["text"] for s in a["steps"]]
    assert any("pins 13 and 14" in t for t in texts)
    for s in a["steps"]:
        assert s["chunk_ids"], "every step carries a citation"
    cits = a["citations"].values()
    assert len({c["page_no"] for c in cits}) == 1 and all(c["section"].startswith("4.2.3") for c in cits)
    labels = {c["label"] for c in cits}
    assert {"Table 4-3", "Fig. 12"} <= labels
    fig = next(c for c in cits if c["label"] == "Fig. 12")
    assert len(fig["bbox"]) == 4 and fig["image_url"].startswith("/api/pages/")
    assert client.get(fig["image_url"]).status_code == 200


def test_a_follow_up_keeps_the_machine_and_the_evidence(client):
    """"And what is the torque spec?" is not a new question: it continues the last one."""
    a = ask(client, "Conveyor stopped with fault E-42, what do I check?")
    r = client.post("/api/ask", data={"asset": "", "question": "and what is the torque spec?",
                                      "follow_up_to": a["id"]})
    assert r.status_code == 200, r.text
    b = r.json()
    assert b["parent_id"] == a["id"] and b["follow_up_to"] == a["id"]
    assert b["asset"]["tag"] == "CV-12", "a follow-up stays on the machine, with no tag sent"
    assert b["steps"] and all(s["chunk_ids"] for s in b["steps"]), "a follow-up is cited like any answer"

    # The pages the first answer rested on are still in play for the second.
    first = {cid for c in a["steps"] + a["warnings"] for cid in c["chunk_ids"]}
    assert first & {h["chunk_id"] for h in b["retrieved"]}

    # The thread is walkable afterwards, which is what the history page shows.
    assert client.get(f"/api/queries/{b['id']}").json()["parent_id"] == a["id"]
    assert client.post("/api/ask", data={"question": "x", "follow_up_to": 999999}).status_code == 404


def test_asset_scope_keeps_other_machines_out(client):
    a = ask(client, "low flow alarm P-11", asset="CV-12")
    assert all(c["document"]["title"] != "PMP-07 Coolant Pump Service Instructions" for c in a["citations"].values() if c["document"])
    b = ask(client, "low flow alarm P-11", asset="PMP-07")
    assert b["confidence"] == "verified"
    assert any("strainer" in s["text"] for s in b["steps"])


def test_not_found_names_the_gap(client):
    a = ask(client, "How do I recalibrate the laser height scanner?")
    assert a["confidence"] == "not_found"
    assert a["steps"] == [] and a["gap"]


def test_mismatch_is_revised_from_the_bulletin(client):
    a = ask(client, "fault E-42")
    k3 = next(i for i, s in enumerate(a["steps"]) if "locate relay K3" in s["text"])
    r = client.post(f"/api/queries/{a['id']}/flag",
                    data={"step_index": k3, "note": "There is no K3 here, that slot says SPARE and the relay is K4"})
    assert r.status_code == 200, r.text
    out = r.json()
    assert out["outcome"] == "revised"
    rev = out["revised"]
    assert rev["parent_id"] == a["id"]
    new = [rev["steps"][i] for i in rev["revised_indices"]]
    assert new and all("K4" in s["text"] for s in new)
    assert any("Measure continuity" in s["text"] for s in new)
    cited = {rev["citations"][str(c)]["document"]["title"] for s in new for c in s["chunk_ids"]}
    assert cited == {"Service Bulletin SB-2023-04"}
    assert any(rev["citations"][str(c)]["page_no"] == 2 for s in new for c in s["chunk_ids"])
    # Steps before the flagged one are unchanged; later steps about K3 no longer apply; the rest are kept.
    assert rev["steps"][:k3] == a["steps"][:k3]
    stale = [s for s in a["steps"][k3:] if "K3" in s["text"]]
    assert stale and not any(s in rev["steps"] for s in stale)
    assert rev["steps"][-1]["text"].startswith("Close panel B")


def test_unresolved_mismatch_escalates_then_fix_note_becomes_a_source(client):
    a = ask(client, "fault E-42")
    i = next(i for i, s in enumerate(a["steps"]) if "Torque terminals" in s["text"])
    r = client.post(f"/api/queries/{a['id']}/flag",
                    data={"step_index": i, "note": "Terminals are push-in spring type X9Q, no screws to torque"})
    out = r.json()
    assert out["outcome"] == "escalated"
    flag = out["flag"]
    assert flag["status"] == "open" and flag["owner"] == "Reliability engineering"

    inbox = client.get("/api/flags", params={"status": "open"}).json()
    assert any(f["id"] == flag["id"] and f["citations"] for f in inbox)

    r = client.post(f"/api/flags/{flag['id']}/fixnote",
                    json={"author": "M. Okafor", "text": "CV-12 relays with X9Q push-in terminals need no torque; "
                                                           "push the conductor in fully and tug-test it."})
    assert r.status_code == 200 and r.json()["status"] == "resolved"

    b = ask(client, "E-42 relay has X9Q push-in terminals")
    fix = [c for c in b["citations"].values() if c["kind"] == "fixnote"]
    assert fix and fix[0]["author"] == "M. Okafor"


def test_scanned_page_is_cited_with_a_warning(client):
    a = ask(client, "What does terminal X4:7 carry after the line 3 interlock rewiring?")
    assert a["confidence"] == "unverified"
    scans = [c for c in a["citations"].values() if c["extractor"].startswith("docling-ocr")]
    assert scans and scans[0]["status"] == "unverified"


def test_quarantined_scan_cannot_be_approved_without_content(client):
    queue = client.get("/api/review").json()
    page = next(p for p in queue if p["status"] == "quarantined")
    r = client.post(f"/api/pages/{page['id']}/review", json={"action": "approve"})
    assert r.status_code == 400
    r = client.post(f"/api/pages/{page['id']}/review", json={"action": "reject", "reviewer": "QA"})
    assert r.json()["status"] == "rejected"


def test_upload_ingests_a_pdf(client):
    import time

    import pymupdf

    doc = pymupdf.open()
    page = doc.new_page()
    page.insert_textbox(pymupdf.Rect(64, 64, 548, 400),
                        "2.1 Hydraulic unit HU-3\nIf alarm H-09 appears, check the return filter indicator and "
                        "replace element HF-220 when red.", fontsize=11)
    pdf = doc.tobytes()
    r = client.post("/api/documents", files={"file": ("hu3.pdf", pdf, "application/pdf")},
                    data={"title": "HU-3 Hydraulic Unit", "version": "A", "owner": "Hydraulics", "assets": "CV-14"})
    assert r.status_code == 200, r.text
    doc_id = r.json()["id"]
    for _ in range(600):  # Docling needs a few seconds per document
        d = client.get(f"/api/documents/{doc_id}").json()
        if d["status"] != "processing":
            break
        time.sleep(0.2)
    assert d["status"] == "ready" and d["pages"][0]["status"] == "verified"
    a = ask(client, "alarm H-09", asset="CV-14")
    assert any("HF-220" in s["text"] for s in a["steps"])


def test_rejects_non_pdf_and_empty_questions(client):
    r = client.post("/api/documents", files={"file": ("x.pdf", b"hello", "application/pdf")}, data={"title": "x"})
    assert r.status_code == 400
    assert client.post("/api/ask", data={"asset": "CV-12", "question": " "}).status_code == 400
    assert client.post("/api/ask", data={"asset": "NOPE", "question": "hi"}).status_code == 404
