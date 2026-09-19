"""Qdrant index: text chunks and figure captions, searched by keyword and meaning in one query.

Each chunk has three vectors:
  dense  semantic embedding (FastEmbed, runs locally)
  bm25   keyword sparse vector with IDF
  codes  exact identifiers only (E-42, K3, 3RT2016-1BB42), so a part number matches exactly
Results of the three are fused with reciprocal rank fusion. The payload carries the chunk's
asset ids and page status, so quarantined pages and other machines' manuals are filtered in Qdrant.
"""
import logging
import threading
import zlib
from collections import Counter

from qdrant_client import QdrantClient, models

from . import config, db
from .search_text import is_code, tokenize

log = logging.getLogger("foreman.index")
_client: QdrantClient | None = None
_models: dict = {}
_lock = threading.Lock()
CITABLE = ["verified", "unverified"]


def client() -> QdrantClient:
    global _client
    if _client is None:
        _client = QdrantClient(url=config.QDRANT_URL, timeout=30)
    return _client


def _model(kind: str):
    """Embedding and rerank models load once, on first use (they download on the first run)."""
    with _lock:
        if kind not in _models:
            if kind == "dense":
                from fastembed import TextEmbedding
                _models[kind] = TextEmbedding(config.DENSE_MODEL)
            elif kind == "sparse":
                from fastembed import SparseTextEmbedding
                _models[kind] = SparseTextEmbedding(config.SPARSE_MODEL)
            elif kind == "rerank":
                from fastembed.rerank.cross_encoder import TextCrossEncoder
                _models[kind] = TextCrossEncoder(config.RERANK_MODEL)
        return _models[kind]


def dense_size() -> int:
    return len(next(iter(_model("dense").embed(["size probe"]))))


def init(recreate: bool = False) -> None:
    c = client()
    name = config.QDRANT_COLLECTION
    if recreate and c.collection_exists(name):
        c.delete_collection(name)
    if not c.collection_exists(name):
        c.create_collection(
            name,
            vectors_config={"dense": models.VectorParams(size=dense_size(), distance=models.Distance.COSINE)},
            sparse_vectors_config={
                "bm25": models.SparseVectorParams(modifier=models.Modifier.IDF),
                "codes": models.SparseVectorParams(modifier=models.Modifier.IDF),
            },
        )
        for field, schema in [("asset_ids", models.PayloadSchemaType.INTEGER),
                              ("document_id", models.PayloadSchemaType.INTEGER),
                              ("page_id", models.PayloadSchemaType.INTEGER),
                              ("status", models.PayloadSchemaType.KEYWORD)]:
            c.create_payload_index(name, field, field_schema=schema)


def _codes_vector(text: str) -> models.SparseVector:
    counts = Counter(t for t in tokenize(text) if is_code(t))
    merged: dict[int, float] = {}
    for tok, n in counts.items():
        idx = zlib.crc32(tok.encode()) & 0x7FFFFFFF
        merged[idx] = merged.get(idx, 0) + float(n)
    return models.SparseVector(indices=list(merged), values=list(merged.values()))


def _sparse(sv) -> models.SparseVector:
    return models.SparseVector(indices=sv.indices.tolist(), values=sv.values.tolist())


def index_text(c: dict) -> str:
    return f"{c.get('label') or ''} {c.get('section') or ''}\n{c['text']}".strip()


def upsert(chunks: list[dict]) -> None:
    """chunks: dicts with id, document_id, page_id, kind, label, section, text, status, asset_ids."""
    if not chunks:
        return
    texts = [index_text(c) for c in chunks]
    dense = list(_model("dense").embed(texts))
    sparse = list(_model("sparse").embed(texts))
    points = [
        models.PointStruct(
            id=c["id"],
            vector={"dense": d.tolist(), "bm25": _sparse(s), "codes": _codes_vector(t)},
            payload={"chunk_id": c["id"], "document_id": c.get("document_id"), "page_id": c.get("page_id"),
                     "kind": c["kind"], "status": c["status"], "asset_ids": c["asset_ids"]},
        )
        for c, t, d, s in zip(chunks, texts, dense, sparse)
    ]
    client().upsert(config.QDRANT_COLLECTION, points=points, wait=True)


def index_document(conn, document_id: int) -> None:
    delete_document(document_id)
    asset_ids = [r["asset_id"] for r in conn.execute(
        "SELECT asset_id FROM document_assets WHERE document_id=%s", (document_id,))]
    rows = db.rows(conn.execute(
        "SELECT c.id, c.document_id, c.page_id, c.kind, c.label, c.section, c.text, p.status "
        "FROM chunks c JOIN pages p ON p.id=c.page_id WHERE c.document_id=%s", (document_id,)))
    for r in rows:
        r["asset_ids"] = asset_ids
    for i in range(0, len(rows), 64):
        upsert(rows[i:i + 64])


def index_fix_note(chunk: dict) -> None:
    upsert([{**chunk, "document_id": None, "page_id": None, "status": "verified",
             "asset_ids": [chunk["asset_id"]] if chunk.get("asset_id") else []}])


def delete_document(document_id: int) -> None:
    client().delete(config.QDRANT_COLLECTION, points_selector=models.FilterSelector(filter=models.Filter(
        must=[models.FieldCondition(key="document_id", match=models.MatchValue(value=document_id))])), wait=True)


def set_page_status(page_id: int, status: str) -> None:
    client().set_payload(config.QDRANT_COLLECTION, payload={"status": status}, wait=True,
                         points=models.Filter(must=[models.FieldCondition(key="page_id", match=models.MatchValue(value=page_id))]))


def set_document_assets(document_id: int, asset_ids: list[int]) -> None:
    client().set_payload(config.QDRANT_COLLECTION, payload={"asset_ids": asset_ids}, wait=True,
                         points=models.Filter(must=[models.FieldCondition(key="document_id", match=models.MatchValue(value=document_id))]))


def query(text: str, asset_id: int | None, exclude: set[int] | None = None, limit: int = 30,
          codes_text: str = "") -> list[tuple[int, float]]:
    """Hybrid search. Returns [(chunk_id, fused score)] best first."""
    must = [models.FieldCondition(key="status", match=models.MatchAny(any=CITABLE))]
    if asset_id is not None:
        must.append(models.FieldCondition(key="asset_ids", match=models.MatchAny(any=[asset_id])))
    must_not = [models.HasIdCondition(has_id=sorted(exclude))] if exclude else []
    flt = models.Filter(must=must, must_not=must_not)

    dense = next(iter(_model("dense").query_embed([text]))).tolist()
    sparse = _sparse(next(iter(_model("sparse").query_embed([text]))))
    prefetch = [models.Prefetch(query=dense, using="dense", limit=limit, filter=flt),
                models.Prefetch(query=sparse, using="bm25", limit=limit, filter=flt)]
    codes = _codes_vector(text + " " + codes_text)
    if codes.indices:
        prefetch.append(models.Prefetch(query=codes, using="codes", limit=limit, filter=flt))
    res = client().query_points(config.QDRANT_COLLECTION, prefetch=prefetch,
                                query=models.FusionQuery(fusion=models.Fusion.RRF), limit=limit, with_payload=False)
    return [(int(p.id), p.score) for p in res.points]


def rerank(question: str, texts: list[str]) -> list[float]:
    return [float(s) for s in _model("rerank").rerank(question, texts)]


def rebuild(conn) -> None:
    init(recreate=True)
    for d in conn.execute("SELECT id FROM documents WHERE status='ready'").fetchall():
        index_document(conn, d["id"])
    for c in conn.execute("SELECT id, asset_id, kind, label, section, text FROM chunks WHERE kind='fixnote'").fetchall():
        index_fix_note(dict(c))


def count() -> int:
    return client().count(config.QDRANT_COLLECTION, exact=True).count
