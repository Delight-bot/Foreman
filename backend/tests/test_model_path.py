"""The model path, with the Claude call replaced by a scripted fake: checks the pipeline around it."""
import re

import pytest

from app import answer, config, db, llm


@pytest.fixture
def model_on(monkeypatch, client):
    calls = []

    def fake_parse(system, content, schema, effort="medium", max_tokens=16000):
        calls.append({"schema": schema.__name__, "content": content, "effort": effort})
        text = "\n".join(b.get("text", "") for b in content if b["type"] == "text")
        ids = [int(i) for i in re.findall(r"\[chunk (\d+)\]", text)]
        if schema is answer.Understanding:
            return answer.Understanding(observation="", search_terms=["relay"], codes=["E-42"]), "claude-opus-5"
        if schema is answer.Draft:
            return script["draft"](ids, text), "claude-opus-5"
        if schema is answer.Verdicts:
            return answer.Verdicts(checks=[answer.Check(index=i, supported=i not in script["reject"], reason="value differs")
                                           for i in range(text.count("Claim "))]), "claude-opus-5"
        raise AssertionError(schema)

    script = {"reject": set()}
    monkeypatch.setattr(config, "llm_enabled", lambda: True)
    monkeypatch.setattr(llm, "parse", fake_parse)
    return script, calls


def _cv12(conn):
    return db.row(conn.execute("SELECT * FROM assets WHERE tag='CV-12'").fetchone())


def test_claim_check_drops_unsupported_and_uncited_claims(model_on):
    script, calls = model_on
    script["draft"] = lambda ids, text: answer.Draft(
        found=True, gap="",
        warnings=[answer.Claim(text="Lock out Q1 and F7.", chunk_ids=[ids[0]])],
        steps=[answer.Claim(text="Measure pins 13 and 14.", chunk_ids=[ids[0]]),
               answer.Claim(text="Torque to 2 N·m.", chunk_ids=[ids[0]]),       # rejected by the check
               answer.Claim(text="Invented step.", chunk_ids=[999999])])        # cites nothing retrieved
    script["reject"] = {2}  # claim order: warning 0, step 1, step 2
    conn = db.connect()
    a = answer.ask(conn, _cv12(conn), "E-42", None)
    assert a["mode"] == "model" and a["model"] == "claude-opus-5"
    assert [s["text"] for s in a["steps"]] == ["Measure pins 13 and 14."]
    assert {d["text"] for d in a["dropped"]} == {"Torque to 2 N·m.", "Invented step."}
    draft_call = next(c for c in calls if c["schema"] == "Draft")
    assert any(b["type"] == "image" for b in draft_call["content"]), "figure and table crops go to the model"


def test_model_revision_needs_new_evidence(model_on):
    script, _ = model_on
    conn = db.connect()
    script["draft"] = lambda ids, text: answer.Draft(
        found=True, gap="", warnings=[], steps=[answer.Claim(text="Open panel B and find K3.", chunk_ids=[ids[0]])])
    a = answer.ask(conn, _cv12(conn), "E-42", None)
    original = {cid for s in a["steps"] for cid in s["chunk_ids"]}

    # Restating an original page is not a revision: escalate.
    script["draft"] = lambda ids, text: answer.Draft(
        found=True, gap="", warnings=[], steps=[answer.Claim(text="Find K3.", chunk_ids=[next(i for i in ids if i in original)])])
    out = answer.flag_step(conn, a["id"], 0, "Relay is K4", None)
    assert out["outcome"] == "escalated"

    # A step resting on a page the technician was not shown before is a revision.
    script["draft"] = lambda ids, text: answer.Draft(
        found=True, gap="", warnings=[], steps=[answer.Claim(text="Find K4.", chunk_ids=[next(i for i in ids if i not in original)])])
    out = answer.flag_step(conn, a["id"], 0, "Relay is K4", None)
    assert out["outcome"] == "revised"
    assert out["revised"]["revised_indices"] == [0]


def test_model_failure_falls_back_to_extractive(monkeypatch, client):
    def down(*a, **k):
        raise llm.LLMUnavailable("could not reach the Claude API")

    monkeypatch.setattr(config, "llm_enabled", lambda: True)
    monkeypatch.setattr(llm, "parse", down)
    conn = db.connect()
    a = answer.ask(conn, _cv12(conn), "fault E-42", None)
    assert a["mode"] == "extractive" and a["confidence"] == "verified" and a["steps"]
