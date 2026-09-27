import logging
import os
import re
import threading
import uuid
from contextlib import asynccontextmanager

from fastapi import BackgroundTasks, Depends, FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel

from . import answer, config, db, graph, index, ingest

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
log = logging.getLogger("foreman")
MAX_PHOTO = 8 * 1024 * 1024
MAX_PDF = 60 * 1024 * 1024


@asynccontextmanager
async def lifespan(app: FastAPI):
    db.init()
    index.init()
    graph.init()
    if os.environ.get("FOREMAN_SEED", "1") == "1":
        from .sample import seed_if_empty
        # Docling takes a minute or two on the demo manuals; the API is usable meanwhile.
        threading.Thread(target=seed_if_empty, daemon=True, name="seed").start()
    yield
    graph.close()
    db.close()


app = FastAPI(title="Foreman", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:3001"], allow_methods=["*"], allow_headers=["*"])


def conn():
    with db.session() as c:
        yield c


def _asset_or_404(c, tag: str) -> dict:
    a = db.row(c.execute("SELECT * FROM assets WHERE lower(tag)=lower(%s)", (tag.strip(),)).fetchone())
    if a is None:
        raise HTTPException(404, f"No asset with tag {tag}")
    return a


def _read_photo(photo: UploadFile | None) -> bytes | None:
    if photo is None or not photo.filename:
        return None
    data = photo.file.read(MAX_PHOTO + 1)
    if len(data) > MAX_PHOTO:
        raise HTTPException(413, "Photo is larger than 8 MB")
    return data or None


# ---------- status ----------

def _pg_probe():
    with db.session() as c:
        c.execute("SELECT 1")


@app.get("/api/health")
def health():
    services = {}
    for name, probe in [("postgres", _pg_probe),
                        ("qdrant", index.count),
                        ("neo4j", lambda: graph.run("RETURN 1"))]:
        try:
            probe()
            services[name] = True
        except Exception:
            services[name] = False
    return {"ok": all(services.values()), "services": services, "llm": config.llm_enabled(),
            "model": config.MODEL if config.llm_enabled() else None}


@app.get("/api/stats")
def stats(c=Depends(conn)):
    """What each store holds: PostgreSQL rows, Qdrant points, Neo4j nodes."""
    pg = c.execute("""SELECT (SELECT count(*) FROM documents) AS documents, (SELECT count(*) FROM pages) AS pages,
                             (SELECT count(*) FROM chunks) AS chunks, (SELECT count(*) FROM queries) AS answers""").fetchone()
    return {"postgres": pg, "qdrant": {"points": index.count()}, "neo4j": graph.stats()}


# ---------- assets ----------

class AssetIn(BaseModel):
    tag: str
    name: str
    location: str = ""


@app.get("/api/assets")
def list_assets(c=Depends(conn)):
    assets = db.rows(c.execute("SELECT * FROM assets ORDER BY tag"))
    for a in assets:
        a["documents"] = db.rows(c.execute(
            "SELECT d.id, d.title, d.version FROM documents d JOIN document_assets da ON da.document_id=d.id "
            "WHERE da.asset_id=%s ORDER BY d.title", (a["id"],)))
        a["open_flags"] = c.execute(
            "SELECT count(*) AS n FROM flags f JOIN queries q ON q.id=f.query_id WHERE q.asset_id=%s AND f.status='open'",
            (a["id"],)).fetchone()["n"]
    return assets


@app.post("/api/assets")
def create_asset(body: AssetIn, c=Depends(conn)):
    tag = body.tag.strip().upper()
    if not re.fullmatch(r"[A-Z0-9][A-Z0-9._-]{0,31}", tag):
        raise HTTPException(400, "Tag must be letters, digits, dots, dashes or underscores")
    if c.execute("SELECT 1 FROM assets WHERE tag=%s", (tag,)).fetchone():
        raise HTTPException(409, f"Asset {tag} already exists")
    c.execute("INSERT INTO assets(tag, name, location) VALUES(%s,%s,%s)", (tag, body.name.strip(), body.location.strip()))
    graph.upsert_asset(tag, body.name.strip())
    return _asset_or_404(c, tag)


@app.get("/api/assets/{tag}")
def get_asset(tag: str, c=Depends(conn)):
    a = _asset_or_404(c, tag)
    a["documents"] = db.rows(c.execute(
        "SELECT d.id, d.title, d.version, d.owner FROM documents d JOIN document_assets da ON da.document_id=d.id "
        "WHERE da.asset_id=%s ORDER BY d.title", (a["id"],)))
    a["recent"] = db.rows(c.execute(
        "SELECT id, question, confidence, created_at FROM queries WHERE asset_id=%s AND parent_id IS NULL "
        "ORDER BY id DESC LIMIT 5", (a["id"],)))
    return a


# ---------- documents ----------

def _doc_summary(c, d: dict) -> dict:
    d["pages_by_status"] = {r["status"]: r["n"] for r in c.execute(
        "SELECT status, count(*) AS n FROM pages WHERE document_id=%s GROUP BY status", (d["id"],))}
    d["assets"] = [r["tag"] for r in c.execute(
        "SELECT a.tag FROM assets a JOIN document_assets da ON da.asset_id=a.id WHERE da.document_id=%s ORDER BY a.tag",
        (d["id"],))]
    d["chunks"] = c.execute("SELECT count(*) AS n FROM chunks WHERE document_id=%s", (d["id"],)).fetchone()["n"]
    return d


@app.get("/api/documents")
def list_documents(c=Depends(conn)):
    return [_doc_summary(c, d) for d in db.rows(c.execute("SELECT * FROM documents ORDER BY created_at DESC, id DESC"))]


@app.post("/api/documents")
def upload_document(
    tasks: BackgroundTasks,
    file: UploadFile = File(...),
    title: str = Form(...),
    version: str = Form(""),
    owner: str = Form(""),
    owner_contact: str = Form(""),
    assets: str = Form(""),
    page_from: int | None = Form(None),
    page_to: int | None = Form(None),
    c=Depends(conn),
):
    data = file.file.read(MAX_PDF + 1)
    if not data.startswith(b"%PDF"):
        raise HTTPException(400, "Upload a PDF")
    if len(data) > MAX_PDF:
        raise HTTPException(413, "PDF is larger than 60 MB")
    tags = [t for t in re.split(r"[,\s]+", assets) if t]
    asset_rows = [_asset_or_404(c, t) for t in tags]
    filename = f"{uuid.uuid4().hex}.pdf"
    (config.FILES_DIR / filename).write_bytes(data)
    doc_id = c.execute("INSERT INTO documents(title, version, filename, owner, owner_contact, page_from, page_to) "
                       "VALUES(%s,%s,%s,%s,%s,%s,%s) RETURNING id",
                       (title.strip(), version.strip(), filename, owner.strip(), owner_contact.strip(),
                        page_from or None, page_to or None)).fetchone()["id"]
    for a in asset_rows:
        c.execute("INSERT INTO document_assets VALUES(%s,%s) ON CONFLICT DO NOTHING", (doc_id, a["id"]))
    c.commit()
    tasks.add_task(ingest.ingest_document, doc_id)
    return _doc_summary(c, db.row(c.execute("SELECT * FROM documents WHERE id=%s", (doc_id,)).fetchone()))


@app.get("/api/documents/{doc_id}")
def get_document(doc_id: int, c=Depends(conn)):
    d = db.row(c.execute("SELECT * FROM documents WHERE id=%s", (doc_id,)).fetchone())
    if d is None:
        raise HTTPException(404, "Document not found")
    d = _doc_summary(c, d)
    d["pages"] = db.rows(c.execute("SELECT * FROM pages WHERE document_id=%s ORDER BY page_no", (doc_id,)))
    chunks = db.rows(c.execute("SELECT id, page_id, kind, label, section, text, bbox, extractor, confidence "
                               "FROM chunks WHERE document_id=%s ORDER BY page_no, id", (doc_id,)))
    by_page: dict[int, list] = {}
    for ch in chunks:
        by_page.setdefault(ch["page_id"], []).append(ch)
    for p in d["pages"]:
        p["chunks"] = by_page.get(p["id"], [])
        p["image_url"] = f"/api/pages/{p['id']}/image"
    return d


@app.put("/api/documents/{doc_id}/assets")
def set_document_assets(doc_id: int, tags: list[str], c=Depends(conn)):
    if not c.execute("SELECT 1 FROM documents WHERE id=%s", (doc_id,)).fetchone():
        raise HTTPException(404, "Document not found")
    rows = [_asset_or_404(c, t) for t in tags]
    c.execute("DELETE FROM document_assets WHERE document_id=%s", (doc_id,))
    for a in rows:
        c.execute("INSERT INTO document_assets VALUES(%s,%s)", (doc_id, a["id"]))
    index.set_document_assets(doc_id, [a["id"] for a in rows])
    graph.link_assets(doc_id, [a["tag"] for a in rows])
    return {"ok": True}


@app.delete("/api/documents/{doc_id}")
def delete_document(doc_id: int, c=Depends(conn)):
    d = db.row(c.execute("SELECT * FROM documents WHERE id=%s", (doc_id,)).fetchone())
    if d is None:
        raise HTTPException(404, "Document not found")
    c.execute("DELETE FROM documents WHERE id=%s", (doc_id,))
    index.delete_document(doc_id)
    graph.delete_document(doc_id)
    (config.FILES_DIR / d["filename"]).unlink(missing_ok=True)
    return {"ok": True}


# ---------- review queue ----------

@app.get("/api/review")
def review_queue(c=Depends(conn)):
    rows = db.rows(c.execute(
        "SELECT p.*, d.title, d.version, d.owner FROM pages p JOIN documents d ON d.id=p.document_id "
        "WHERE p.status IN ('quarantined','unverified') ORDER BY p.status DESC, d.title, p.page_no"))
    for p in rows:
        p["image_url"] = f"/api/pages/{p['id']}/image"
        p["chunks"] = db.rows(c.execute("SELECT id, kind, label, text, bbox FROM chunks WHERE page_id=%s ORDER BY id",
                                        (p["id"],)))
    return rows


class ReviewIn(BaseModel):
    action: str  # approve | reject
    reviewer: str = ""


@app.post("/api/pages/{page_id}/review")
def review_page(page_id: int, body: ReviewIn, c=Depends(conn)):
    p = db.row(c.execute("SELECT * FROM pages WHERE id=%s", (page_id,)).fetchone())
    if p is None:
        raise HTTPException(404, "Page not found")
    if body.action == "approve":
        if not c.execute("SELECT 1 FROM chunks WHERE page_id=%s", (page_id,)).fetchone():
            raise HTTPException(400, "This page has no extracted content to approve. Upload a clearer scan.")
        status = "verified"
    elif body.action == "reject":
        status = "rejected"
    else:
        raise HTTPException(400, "action must be approve or reject")
    who = body.reviewer.strip() or "owner"
    c.execute("UPDATE pages SET status=%s, reason=%s WHERE id=%s", (status, f"Reviewed by {who}", page_id))
    index.set_page_status(page_id, status)  # the index filters on it, so this takes effect at once
    return {"ok": True, "status": status}


@app.get("/api/pages/{page_id}/image")
def page_image(page_id: int, c=Depends(conn)):
    p = c.execute("SELECT image FROM pages WHERE id=%s", (page_id,)).fetchone()
    if p is None:
        raise HTTPException(404, "Page not found")
    return FileResponse(config.PAGES_DIR / p["image"], media_type="image/png",
                        headers={"Cache-Control": "public, max-age=86400"})


@app.get("/api/uploads/{name}")
def uploaded(name: str):
    if not re.fullmatch(r"[0-9a-f]{32}\.(jpg|png|webp|gif)", name):
        raise HTTPException(404)
    path = config.UPLOADS_DIR / name
    if not path.exists():
        raise HTTPException(404)
    return FileResponse(path)


# ---------- ask, flag, escalate ----------

@app.post("/api/ask")
def ask(asset: str = Form(""), question: str = Form(""), photo: UploadFile | None = File(None), c=Depends(conn)):
    img = _read_photo(photo)
    if not question.strip() and not img:
        raise HTTPException(400, "Ask a question or add a photo")
    a = _asset_or_404(c, asset) if asset.strip() else None
    return answer.ask(c, a, question.strip(), img)


@app.get("/api/queries")
def list_queries(limit: int = 50, c=Depends(conn)):
    return db.rows(c.execute(
        "SELECT q.id, q.question, q.confidence, q.mode, q.model, q.parent_id, q.created_at, a.tag AS asset_tag, "
        "(SELECT count(*) FROM flags f WHERE f.query_id=q.id) AS flags "
        "FROM queries q LEFT JOIN assets a ON a.id=q.asset_id ORDER BY q.id DESC LIMIT %s", (min(limit, 200),)))


@app.get("/api/queries/{query_id}")
def get_query(query_id: int, c=Depends(conn)):
    q = answer.get_query(c, query_id)
    if q is None:
        raise HTTPException(404, "Answer not found")
    return q


@app.post("/api/queries/{query_id}/flag")
def flag(query_id: int, step_index: int = Form(...), note: str = Form(""),
         photo: UploadFile | None = File(None), c=Depends(conn)):
    img = _read_photo(photo)
    if not note.strip() and not img:
        raise HTTPException(400, "Say or photograph what is different")
    try:
        return answer.flag_step(c, query_id, step_index, note.strip(), img)
    except KeyError:
        raise HTTPException(404, "Answer not found")
    except IndexError:
        raise HTTPException(400, "No such step")


@app.get("/api/flags")
def list_flags(status: str | None = None, c=Depends(conn)):
    sql = ("SELECT f.*, q.question, a.tag AS asset_tag, a.name AS asset_name, a.location AS asset_location "
           "FROM flags f JOIN queries q ON q.id=f.query_id LEFT JOIN assets a ON a.id=q.asset_id")
    params: tuple = ()
    if status:
        sql += " WHERE f.status=%s"
        params = (status,)
    rows = db.rows(c.execute(sql + " ORDER BY f.status='open' DESC, f.id DESC", params))
    for f in rows:
        f["photo_url"] = f"/api/uploads/{f['photo']}" if f["photo"] else None
        q = answer.get_query(c, f["query_id"])
        step = q["steps"][f["step_index"]] if q and f["step_index"] < len(q["steps"]) else None
        f["citations"] = [q["citations"].get(str(i)) for i in step["chunk_ids"]] if step else []
        if f["fix_chunk_id"]:
            f["fix_note"] = answer.citation(c, f["fix_chunk_id"])
    return rows


class FixNoteIn(BaseModel):
    author: str = ""
    text: str


@app.post("/api/flags/{flag_id}/fixnote")
def fix_note(flag_id: int, body: FixNoteIn, c=Depends(conn)):
    if len(body.text.strip()) < 10:
        raise HTTPException(400, "Write the fix in a sentence or two")
    try:
        return answer.add_fix_note(c, flag_id, body.author, body.text)
    except KeyError:
        raise HTTPException(404, "Flag not found")
