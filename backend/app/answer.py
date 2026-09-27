"""Answer and prove: from a technician's question to warning-first, cited, checked steps.

With the model: understand the question and photo, search, draft steps that cite chunk IDs,
then check each claim against its cited passage and drop what the passage does not support.
Without the model (extractive mode): the steps are lifted verbatim from the best-matching
procedure, so every step is its own citation.
"""
import logging
import re
import uuid

from pydantic import BaseModel

from . import config, db, graph, index, ingest, llm
from .entities import refs_in
from .search import search
from .search_text import is_code, tokenize

log = logging.getLogger("foreman.answer")


class Understanding(BaseModel):
    observation: str       # what the photo shows, in one or two sentences ("" if no photo)
    search_terms: list[str]
    codes: list[str]       # fault codes, part numbers, terminal numbers seen or mentioned


class Claim(BaseModel):
    text: str
    chunk_ids: list[int]


class Draft(BaseModel):
    found: bool
    warnings: list[Claim]
    steps: list[Claim]
    gap: str  # what the documents do not cover; "" when fully answered


class Check(BaseModel):
    index: int
    supported: bool
    reason: str


class Verdicts(BaseModel):
    checks: list[Check]


UNDERSTAND_SYSTEM = (
    "You help a maintenance search engine understand a technician's request at a faulted machine. "
    "If there is a photo, read it: error screens, fault codes, part and relay labels, terminal numbers, "
    "nameplates. Report only what is visible or said. Produce search terms a manual would use."
)

ANSWER_SYSTEM = """You are Foreman, a troubleshooting assistant used by technicians standing at a faulted machine.
You answer only from the evidence excerpts provided, each marked [chunk N]. They come from the plant's own manuals,
drawings, tables and document owners' fix notes.

Rules:
- Every warning and every step cites the chunk IDs that directly support it. Cite a table or figure when a value
  or location comes from it.
- Put lock-out, isolation and other safety notes in warnings. They are shown first.
- Steps are short and imperative, one action each, in the order the technician does them, and readable with a
  panel open. Copy exact values (torques, pins, part numbers, codes) from the evidence.
- Never invent a step, value or part number. If the evidence does not contain a procedure for this problem, set
  found to false, give no steps, and say in gap what is missing.
- If the evidence answers only part of the question, answer that part and name the rest in gap."""

VERIFY_SYSTEM = """You audit a maintenance procedure before a technician sees it. For each numbered claim, decide
whether the cited evidence fully supports it: the action is described there and every value, part number,
terminal and code matches exactly. Paraphrase is fine; additions are not. Unsupported claims will be removed."""


def _save_photo(photo: bytes | None) -> str | None:
    if not photo:
        return None
    ext = {"image/png": "png", "image/webp": "webp", "image/gif": "gif"}.get(llm.sniff_media_type(photo), "jpg")
    name = f"{uuid.uuid4().hex}.{ext}"
    (config.UPLOADS_DIR / name).write_bytes(photo)
    return name


def citation(conn, chunk_id: int) -> dict | None:
    c = db.row(conn.execute(
        """SELECT c.*, p.status AS page_status, p.width, p.height, p.image, p.reason AS page_reason, p.label AS page_label,
                  d.title, d.version, d.owner, d.owner_contact
           FROM chunks c LEFT JOIN pages p ON p.id=c.page_id LEFT JOIN documents d ON d.id=c.document_id
           WHERE c.id=%s""", (chunk_id,)).fetchone())
    if c is None:
        return None
    if c["kind"] == "fixnote":
        return {"chunk_id": c["id"], "kind": "fixnote", "label": "Fix note", "text": c["text"],
                "author": c["author"], "created_at": c["created_at"], "status": "verified",
                "document": None, "page_no": None, "bbox": None, "page_size": None, "image_url": None,
                "extractor": c["extractor"]}
    return {
        "chunk_id": c["id"], "kind": c["kind"], "label": c["label"] or f"p. {c['page_label'] or c['page_no']}",
        "section": c["section"], "text": c["text"], "status": c["page_status"],
        "status_reason": c["page_reason"], "extractor": c["extractor"],
        "document": {"id": c["document_id"], "title": c["title"], "version": c["version"],
                     "owner": c["owner"], "owner_contact": c["owner_contact"]},
        "page_no": c["page_no"], "page_label": c["page_label"] or str(c["page_no"]), "page_id": c["page_id"],
        "bbox": db.loads(c["bbox"]),
        "page_size": [c["width"], c["height"]], "image_url": f"/api/pages/{c['page_id']}/image",
    }


def _evidence_content(conn, hits: list[dict], header: str, photo: bytes | None) -> list[dict]:
    content: list[dict] = []
    if photo:
        content += [llm.image_block(photo, llm.sniff_media_type(photo)),
                    {"type": "text", "text": "Photo taken by the technician at the machine."}]
    images = 0
    for h in hits:
        where = "fix note from " + (h["author"] or "document owner") if h["kind"] == "fixnote" else \
            f"{_doc_name(conn, h['document_id'])}, p. {h.get('page_label') or h['page_no']}, {h['label'] or h['section']}"
        status = "" if h["page_status"] == "verified" else " (UNVERIFIED machine-read page)"
        content.append({"type": "text", "text": f"[chunk {h['id']}] {h['kind']} | {where}{status}\n{h['text']}"})
        if h["kind"] in ("figure", "table", "table_row", "schematic") and h["bbox"] and images < 4:
            doc = conn.execute("SELECT filename FROM documents WHERE id=%s", (h["document_id"],)).fetchone()
            try:
                png = ingest.crop_png(str(config.FILES_DIR / doc["filename"]), h["page_no"], db.loads(h["bbox"]))
                content += [llm.image_block(png), {"type": "text", "text": f"(image of chunk {h['id']})"}]
                images += 1
            except Exception:
                log.warning("could not crop chunk %s", h["id"])
    content.append({"type": "text", "text": header})
    return content


def _doc_name(conn, document_id) -> str:
    d = conn.execute("SELECT title, version FROM documents WHERE id=%s", (document_id,)).fetchone()
    return f"{d['title']} {d['version']}".strip() if d else "document"


def understand(question: str, photo: bytes | None) -> dict:
    if not config.llm_enabled() or not (photo or question.strip()):
        return {"observation": "", "search_terms": [], "codes": [t for t in tokenize(question) if is_code(t)]}
    content = []
    if photo:
        content.append(llm.image_block(photo, llm.sniff_media_type(photo)))
    content.append({"type": "text", "text": f"Technician says: {question or '(nothing, photo only)'}"})
    try:
        u, _ = llm.parse(UNDERSTAND_SYSTEM, content, Understanding, effort="low")
        return u.model_dump()
    except llm.LLMUnavailable as e:
        log.warning("understand step skipped: %s", e)
        return {"observation": "", "search_terms": [], "codes": [t for t in tokenize(question) if is_code(t)]}


def _prove(conn, draft: Draft, hits: list[dict]) -> tuple[Draft, list[dict]]:
    """Check each claim against its cited passages; drop what is not supported."""
    by_id = {h["id"]: h for h in hits}
    claims = [("warnings", i, c) for i, c in enumerate(draft.warnings)] + \
             [("steps", i, c) for i, c in enumerate(draft.steps)]
    dropped: list[dict] = []
    keep = []
    for kind, i, c in claims:
        c.chunk_ids = [cid for cid in dict.fromkeys(c.chunk_ids) if cid in by_id]
        (keep if c.chunk_ids else dropped).append((kind, i, c))
    dropped = [{"text": c.text, "reason": "cited no evidence that was retrieved"} for _, _, c in dropped]

    if keep and config.llm_enabled():
        lines = []
        for n, (_, _, c) in enumerate(keep):
            ev = "\n".join(f"  [chunk {cid}] {by_id[cid]['text']}" for cid in c.chunk_ids)
            lines.append(f"Claim {n}: {c.text}\nCited evidence:\n{ev}")
        try:
            v, _ = llm.parse(VERIFY_SYSTEM, [{"type": "text", "text": "\n\n".join(lines)}], Verdicts, effort="medium")
            bad = {ch.index: ch.reason for ch in v.checks if not ch.supported}
            dropped += [{"text": keep[n][2].text, "reason": r} for n, r in bad.items() if n < len(keep)]
            keep = [k for n, k in enumerate(keep) if n not in bad]
        except llm.LLMUnavailable as e:
            # Without a claim check we cannot call the answer verified; the caller downgrades it.
            log.warning("claim check skipped: %s", e)
            raise
    return Draft(found=draft.found and bool(keep), gap=draft.gap,
                 warnings=[c for k, _, c in keep if k == "warnings"],
                 steps=[c for k, _, c in keep if k == "steps"]), dropped


STEP_LINE = re.compile(r"^\s*(\d{1,2})[.)]\s+(.+)")
SENTENCE = re.compile(r"(?<=[.!?])\s+(?=[A-Z])")
ACTION_COLUMN = re.compile(r"what to do|action|remedy|corrective|measure|check", re.I)
LABEL_REF = re.compile(r"\b(Table\s+[\w-]+|Fig\.?\s*[\w-]+)", re.I)


def _numbered_steps(text: str) -> list[str]:
    steps: list[str] = []
    for line in text.splitlines():
        m = STEP_LINE.match(line)
        if m:
            steps.append(m.group(2).strip())
        elif steps and line.strip() and not line.strip().endswith(":"):
            steps[-1] += " " + line.strip()
    return steps


def _norm_label(s: str) -> str:
    return re.sub(r"[\s.]", "", s.lower()).replace("figure", "fig")


def _section_chunks(conn, document_id, section) -> list[dict]:
    return db.rows(conn.execute(
        "SELECT c.*, p.status AS page_status FROM chunks c JOIN pages p ON p.id=c.page_id "
        "WHERE c.document_id=%s AND c.section=%s AND p.status IN ('verified','unverified') ORDER BY c.page_no, c.id",
        (document_id, section)))


def _cite_labels(claims: list[Claim], pool: list[dict]) -> None:
    """A step that names a table or figure also cites it."""
    labelled = {_norm_label(c["label"]): c["id"] for c in pool if c.get("label") and c["kind"] in ("table", "figure")}
    for s in claims:
        for ref in LABEL_REF.findall(s.text):
            cid = labelled.get(_norm_label(ref))
            if cid and cid not in s.chunk_ids:
                s.chunk_ids.append(cid)


def _warning(c: dict) -> Claim:
    return Claim(text=" ".join(c["text"].split()), chunk_ids=[c["id"]])


def _netlist_steps(chunk: dict, terminals: set[str]) -> list[Claim]:
    """The lines of a drawing's netlist that answer the question, verbatim.

    Each line is one thing the vision model reported seeing, so quoting it keeps the answer
    as grounded as a quoted paragraph: nothing here is inferred from the circuit."""
    lines = [ln.strip() for ln in chunk["text"].splitlines()[1:] if refs_in(ln)]
    focused = [ln for ln in lines if any(t in ln for t in terminals)] if terminals else []
    return [Claim(text=ln, chunk_ids=[chunk["id"]]) for ln in (focused or lines)[:8]]


def extractive_draft(conn, hits: list[dict], terminals: set[str] | None = None) -> Draft:
    """Verbatim steps from the best-matching procedure; used when the model is not available."""
    if not hits:
        return Draft(found=False, warnings=[], steps=[], gap="Nothing in the documents for this asset matches.")
    answerable = ("text", "fixnote", "table_row", "schematic")
    top = hits[0] if hits[0]["kind"] in answerable else next((h for h in hits if h["kind"] in answerable), hits[0])
    warnings, steps = [], []

    if top["kind"] == "schematic":
        steps = _netlist_steps(top, terminals or set())
        related = _section_chunks(conn, top["document_id"], top["section"])
        warnings = [_warning(c) for c in related if c["kind"] == "warning"][:2]
    elif top["kind"] == "table_row":
        # One row of a fault-code table: its action column is the procedure.
        lines = [line for line in top["text"].split("\n")[1:] if line.strip()]
        action = next((line for line in lines if ACTION_COLUMN.match(line.split(":", 1)[0])), lines[-1] if lines else "")
        body = action.split(":", 1)[-1].strip() if ":" in action else action
        found = _numbered_steps(body) or [x.strip() for x in SENTENCE.split(body) if len(x.strip()) > 3]
        steps = [Claim(text=x, chunk_ids=[top["id"]]) for x in found]
        cause = next((line for line in lines if line.lower().startswith(("cause", "description"))), "")
        if cause:
            steps.insert(0, Claim(text=cause, chunk_ids=[top["id"]]))
        related = _section_chunks(conn, top["document_id"], top["section"])
        warnings = [_warning(c) for c in related if c["kind"] == "warning"][:2]
    elif top["kind"] == "fixnote":
        steps.append(Claim(text=top["text"], chunk_ids=[top["id"]]))
        related = []
    else:
        related = _section_chunks(conn, top["document_id"], top["section"])
        for c in related:
            if c["kind"] == "warning":
                warnings.append(_warning(c))
            elif c["kind"] == "text":
                steps += [Claim(text=s, chunk_ids=[c["id"]]) for s in _numbered_steps(c["text"])]
        if not steps:
            sentences = [s.strip() for s in SENTENCE.split(top["text"].split("\n", 1)[-1]) if len(s.strip()) > 12]
            steps = [Claim(text=s, chunk_ids=[top["id"]]) for s in sentences[:6]]
        for h in hits:
            if h["kind"] == "fixnote" and h["score"] >= 0.5 * hits[0]["score"]:
                steps.insert(0, Claim(text="Field note: " + h["text"], chunk_ids=[h["id"]]))

    _cite_labels(steps, related + hits)
    return Draft(found=bool(steps), warnings=warnings, steps=steps[:10],
                 gap="" if steps else "No procedure found in the matching pages.")


def extractive_revision(conn, hits: list[dict], new_codes: set[str]) -> tuple[list[Claim], list[Claim]]:
    """Steps (and their warnings) from any procedure that names what the technician reported, verbatim."""
    def names(text):
        return bool(new_codes & set(tokenize(text)))

    steps: list[Claim] = []
    warnings: list[Claim] = []
    pool: list[dict] = list(hits)
    seen: set = set()
    for h in hits:
        if h["kind"] == "fixnote":
            if names(h["text"]):
                steps.append(Claim(text=h["text"], chunk_ids=[h["id"]]))
            continue
        key = (h["document_id"], h["section"])
        if key in seen:
            continue
        seen.add(key)
        rows = _section_chunks(conn, *key)
        found = [Claim(text=s, chunk_ids=[c["id"]]) for c in rows if c["kind"] == "text"
                 for s in _numbered_steps(c["text"]) if names(s)]
        if found:
            steps += found
            warnings += [_warning(c) for c in rows if c["kind"] == "warning"]
            pool += rows
    if not steps:  # no numbered procedure names it: fall back to the sentences that do
        for h in hits:
            if h["kind"] == "text":
                body = h["text"].split("\n", 1)[-1]
                steps = [Claim(text=x.strip(), chunk_ids=[h["id"]]) for x in SENTENCE.split(body) if names(x)][:2]
            if steps:
                break
    unique = list({s.text: s for s in steps}.values())
    _cite_labels(unique, pool)
    return unique, warnings


def _confidence(conn, draft: Draft) -> str:
    if not draft.steps:
        return "not_found"
    for c in draft.warnings + draft.steps:
        for cid in c.chunk_ids:
            cit = citation(conn, cid)
            if cit and cit["status"] != "verified":
                return "unverified"
    return "verified"


def _payload(conn, qrow: dict) -> dict:
    ans = db.loads(qrow["answer"], {})
    ids = {cid for c in ans.get("warnings", []) + ans.get("steps", []) for cid in c["chunk_ids"]}
    if ans.get("closest"):
        ids.add(ans["closest"])
    asset = db.row(conn.execute("SELECT * FROM assets WHERE id=%s", (qrow["asset_id"],)).fetchone()) if qrow["asset_id"] else None
    flags = db.rows(conn.execute("SELECT * FROM flags WHERE query_id=%s ORDER BY id", (qrow["id"],)))
    return {
        "id": qrow["id"], "question": qrow["question"], "asset": asset,
        "photo_url": f"/api/uploads/{qrow['photo']}" if qrow["photo"] else None,
        "confidence": qrow["confidence"], "mode": qrow["mode"], "model": qrow["model"],
        "parent_id": qrow["parent_id"], "created_at": qrow["created_at"],
        "understanding": db.loads(qrow["understanding"], {}),
        "retrieved": db.loads(qrow["retrieved"], []),
        **ans,
        "citations": {str(i): citation(conn, i) for i in sorted(ids)},
        "flags": flags,
    }


def get_query(conn, query_id: int) -> dict | None:
    q = db.row(conn.execute("SELECT * FROM queries WHERE id=%s", (query_id,)).fetchone())
    return _payload(conn, q) if q else None


def _model_draft(conn, hits, header, photo) -> tuple[Draft, list[dict], str]:
    content = _evidence_content(conn, hits, header, photo)
    draft, model = llm.parse(ANSWER_SYSTEM, content, Draft, effort="high")
    proved, dropped = _prove(conn, draft, hits)
    return proved, dropped, model


def _draft(conn, hits, header, photo, terminals: set[str] | None = None) -> tuple[Draft, list[dict], str, str]:
    """Returns (proved draft, dropped claims, mode, model)."""
    if config.llm_enabled() and hits:
        try:
            proved, dropped, model = _model_draft(conn, hits, header, photo)
            return proved, dropped, "model", model
        except llm.LLMUnavailable as e:
            log.warning("falling back to extractive mode: %s", e)
    # Extractive steps are verbatim source text, so each is its own evidence.
    return extractive_draft(conn, hits, terminals), [], "extractive", ""


def ask(conn, asset: dict | None, question: str, photo: bytes | None) -> dict:
    photo_name = _save_photo(photo)
    u = understand(question, photo)
    query_text = " ".join([question, u["observation"], *u["search_terms"], *u["codes"]])
    hits = search(conn, query_text, asset["id"] if asset else None, k=8, boost_terms=u["codes"])

    where = f"Asset: {asset['tag']} {asset['name']} ({asset['location']})." if asset else ""
    header = (f"{where}\nTechnician's question: {question}\n"
              + (f"Photo shows: {u['observation']}\n" if u["observation"] else "")
              + "Write the procedure from the evidence above.")
    draft, dropped, mode, model = _draft(conn, hits, header, photo, refs_in(query_text))
    return _store(conn, asset, question, photo_name, u, hits, draft, dropped, mode, model)


def _store(conn, asset, question, photo_name, u, hits, draft: Draft, dropped, mode, model, parent_id=None,
           extra: dict | None = None) -> dict:
    confidence = _confidence(conn, draft)
    answer = {
        "warnings": [c.model_dump() for c in draft.warnings],
        "steps": [c.model_dump() for c in draft.steps],
        "gap": draft.gap if confidence == "not_found" or draft.gap else "",
        "closest": hits[0]["id"] if confidence == "not_found" and hits else None,
        "dropped": dropped,
        **(extra or {}),
    }
    if confidence == "not_found" and not answer["gap"]:
        answer["gap"] = "The documents for this asset do not describe this problem."
    retrieved = [{"chunk_id": h["id"], "score": h["score"], "label": h["label"], "page_no": h["page_no"],
                  "kind": h["kind"], "rerank": h.get("rerank"), "codes": h.get("codes", []),
                  "graph": h.get("graph", [])} for h in hits]
    cur = conn.execute(
        "INSERT INTO queries(asset_id, question, photo, understanding, retrieved, answer, confidence, mode, model, parent_id)"
        " VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) RETURNING id",
        (asset["id"] if asset else None, question, photo_name, db.dumps(u), db.dumps(retrieved), db.dumps(answer),
         confidence, mode, model or (config.MODEL if mode == "model" else ""), parent_id),
    )
    conn.commit()
    return get_query(conn, cur.fetchone()["id"])


def _chunk_rows(conn, ids) -> list[dict]:
    if not ids:
        return []
    return db.rows(conn.execute(
        "SELECT c.*, COALESCE(p.status, 'verified') AS page_status, 0 AS score FROM chunks c "
        "LEFT JOIN pages p ON p.id=c.page_id WHERE c.id = ANY(%s)", (list(ids),)))


def flag_step(conn, query_id: int, step_index: int, note: str, photo: bytes | None) -> dict:
    """The correction loop: re-search with what the technician sees, then rewrite the rest of the
    procedure from new evidence, or escalate to the document owner when nothing accounts for it."""
    q = db.row(conn.execute("SELECT * FROM queries WHERE id=%s", (query_id,)).fetchone())
    if q is None:
        raise KeyError("query not found")
    ans = db.loads(q["answer"])
    if not 0 <= step_index < len(ans["steps"]):
        raise IndexError("no such step")
    steps = [Claim(**s) for s in ans["steps"]]
    warnings = [Claim(**w) for w in ans["warnings"]]
    step = steps[step_index]
    original_ids = {cid for c in steps + warnings for cid in c.chunk_ids}
    asset = db.row(conn.execute("SELECT * FROM assets WHERE id=%s", (q["asset_id"],)).fetchone()) if q["asset_id"] else None
    photo_name = _save_photo(photo)

    u = understand(note, photo)
    step_codes = {t for t in tokenize(step.text) if is_code(t)}
    note_codes = {t for t in tokenize(note) if is_code(t)} | {t for c in u["codes"] for t in tokenize(c) if is_code(t)}
    new_codes = note_codes - step_codes  # what the technician sees that the step does not mention
    query_text = " ".join([q["question"], step.text, note, u["observation"], *u["search_terms"], *u["codes"]])
    hits = search(conn, query_text, q["asset_id"], k=6, exclude=original_ids, boost_terms=list(new_codes))
    if q["asset_id"] is not None:
        # The machine may not match its own documents (retrofits, revisions), so widen to the whole library.
        seen = {h["id"] for h in hits}
        wider = [h for h in search(conn, query_text, None, k=8, exclude=original_ids, boost_terms=list(new_codes))
                 if h["id"] not in seen]
        hits = sorted(hits + wider[:4], key=lambda h: h["score"], reverse=True)

    new_part: list[Claim] = []
    new_warnings: list[Claim] = []
    dropped: list[dict] = []
    mode, model = "extractive", ""
    if config.llm_enabled() and hits:
        remaining = "\n".join(f"{n + 1}. {s.text} [chunks {', '.join(map(str, s.chunk_ids))}]"
                              for n, s in enumerate(steps) if n >= step_index)
        header = (
            f"Technician's original question: {q['question']}\n"
            f"The procedure from step {step_index + 1} on, as they were given it:\n{remaining}\n\n"
            f"Step {step_index + 1} does not match the machine. They report: {note or '(see photo)'}\n"
            + (f"Photo shows: {u['observation']}\n" if u["observation"] else "")
            + f"Rewrite the procedure from step {step_index + 1} to the end so it fits this machine. Keep original "
              "steps that still apply, citing their original chunks. Replace the steps that conflict with what the "
              "technician sees, citing evidence that accounts for it. If no evidence accounts for what they see, "
              "set found to false and give no steps."
        )
        try:
            draft, dropped, model = _model_draft(conn, hits + _chunk_rows(conn, original_ids), header, photo)
            mode = "model"
            # A revision must rest on something new; restating the old pages is not a fix.
            if draft.found and any(set(s.chunk_ids) - original_ids for s in draft.steps):
                new_part, new_warnings = draft.steps, draft.warnings
        except llm.LLMUnavailable as e:
            log.warning("correction loop falling back to extractive mode: %s", e)
    if mode == "extractive" and new_codes:
        replacement, new_warnings = extractive_revision(conn, hits, new_codes)
        if replacement:
            # Later steps that mention the part the technician says is not there no longer apply.
            kept = [s for s in steps[step_index + 1:] if not (step_codes & set(tokenize(s.text)))]
            new_part = replacement + kept

    owner, contact = "", ""
    for cid in step.chunk_ids:
        cit = citation(conn, cid)
        if cit and cit["document"]:
            owner, contact = cit["document"]["owner"], cit["document"]["owner_contact"]
            break

    revised_id = None
    if new_part:
        known = {" ".join(w.text.lower().split()) for w in warnings}
        warnings += [w for w in new_warnings if " ".join(w.text.lower().split()) not in known]
        new_steps = steps[:step_index] + new_part
        revised_idx = [n for n, s in enumerate(new_steps) if n >= step_index and set(s.chunk_ids) - original_ids]
        out = _store(conn, asset, q["question"], q["photo"], db.loads(q["understanding"], {}), hits,
                     Draft(found=True, warnings=warnings, steps=new_steps, gap=""), dropped, mode, model,
                     parent_id=query_id, extra={"revised_indices": revised_idx, "revised_reason": note})
        revised_id = out["id"]
        outcome, status = "revised", "resolved"
    else:
        outcome, status = "escalated", "open"

    cur = conn.execute(
        "INSERT INTO flags(query_id, step_index, step_text, note, photo, outcome, revised_query_id, owner, owner_contact, status, resolved_at)"
        " VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s, CASE WHEN %s='resolved' THEN now() END) RETURNING id",
        (query_id, step_index, step.text, note, photo_name, outcome, revised_id, owner, contact, status, status),
    )
    conn.commit()
    flag = db.row(conn.execute("SELECT * FROM flags WHERE id=%s", (cur.fetchone()["id"],)).fetchone())
    return {"outcome": outcome, "flag": flag, "revised": get_query(conn, revised_id) if revised_id else None,
            "tried": [{"chunk_id": h["id"], "label": h["label"], "page_no": h["page_no"]} for h in hits[:5]],
            "dropped": dropped}


def add_fix_note(conn, flag_id: int, author: str, text: str) -> dict:
    f = db.row(conn.execute("SELECT * FROM flags WHERE id=%s", (flag_id,)).fetchone())
    if f is None:
        raise KeyError("flag not found")
    q = db.row(conn.execute("SELECT * FROM queries WHERE id=%s", (f["query_id"],)).fetchone())
    body = text.strip()
    context = f"Correction to: {f['step_text']}"
    cur = conn.execute(
        "INSERT INTO chunks(asset_id, kind, section, label, text, extractor, author) VALUES(%s,%s,%s,%s,%s,%s,%s) RETURNING id",
        (q["asset_id"], "fixnote", context, "Fix note", body, "owner", author.strip() or f["owner"] or "Document owner"),
    )
    note_id = cur.fetchone()["id"]
    conn.execute("UPDATE flags SET status='resolved', fix_chunk_id=%s, resolved_at=now() WHERE id=%s", (note_id, flag_id))
    conn.commit()
    # The note becomes searchable (Qdrant) and linked to the machine and the parts it names (Neo4j).
    tag = conn.execute("SELECT tag FROM assets WHERE id=%s", (q["asset_id"],)).fetchone() if q["asset_id"] else None
    index.index_fix_note({"id": note_id, "asset_id": q["asset_id"], "kind": "fixnote", "label": "Fix note",
                          "section": context, "text": body})
    graph.add_fix_note(note_id, tag["tag"] if tag else None, body, context)
    return db.row(conn.execute("SELECT * FROM flags WHERE id=%s", (flag_id,)).fetchone())
