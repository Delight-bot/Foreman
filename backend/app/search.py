"""Find: hybrid search in Qdrant, narrowed by the asset graph in Neo4j, then reranked.

1. Qdrant fuses semantic, BM25 and exact-identifier search, filtered to the machine's
   documents and to citable pages (quarantined pages are never searched).
2. Neo4j adds the chunks of procedures linked to the fault codes, components and parts
   in the question, even when their wording differs.
3. A cross-encoder reranks the candidates; exact code matches and graph links add to the
   score. Candidates that are neither relevant to the reranker nor linked by code or graph
   are dropped, so an unrelated question finds nothing rather than something.
"""
import logging

from . import db, graph, index
from .entities import extract
from .search_text import is_code, tokenize

log = logging.getLogger("foreman.search")

CODE_BOOST = 2.0     # per exact identifier shared with the question
GRAPH_BOOST = 1.5    # per fault code / component / part the graph links it through
FIXNOTE_BOOST = 1.0  # an owner's note on this machine is the most specific source there is
MIN_RERANK = -2.0    # cross-encoder logit below which a candidate is off-topic


def _rows(conn, ids: list[int], asset_id: int | None) -> list[dict]:
    return db.rows(conn.execute(
        """SELECT c.*, COALESCE(p.status, 'verified') AS page_status,
                  (c.kind = 'fixnote' AND c.asset_id IS NOT DISTINCT FROM %(a)s)
                  OR EXISTS (SELECT 1 FROM document_assets da WHERE da.document_id = c.document_id
                             AND da.asset_id = %(a)s) AS on_asset,
                  p.label AS page_label
           FROM chunks c LEFT JOIN pages p ON p.id = c.page_id LEFT JOIN documents d ON d.id = c.document_id
           WHERE c.id = ANY(%(ids)s)
             AND (c.kind = 'fixnote' OR (d.status = 'ready' AND p.status IN ('verified', 'unverified')))""",
        {"ids": ids, "a": asset_id}))


def search(conn, query: str, asset_id: int | None, k: int = 8, exclude: set[int] | None = None,
           boost_terms: list[str] | None = None) -> list[dict]:
    """Best chunks for a question on one machine (or the whole library when asset_id is None)."""
    exclude = exclude or set()
    boost_terms = boost_terms or []
    if not query.strip() and not boost_terms:
        return []
    fused = dict(index.query(query, asset_id, exclude, limit=30, codes_text=" ".join(boost_terms)))

    tag = None
    if asset_id is not None:
        r = conn.execute("SELECT tag FROM assets WHERE id=%s", (asset_id,)).fetchone()
        tag = r["tag"] if r else None
    ents = extract(query + "\n" + " ".join(boost_terms), loose=True)
    try:
        related = graph.related_chunks(ents, tag, library_wide=asset_id is None)
    except Exception as e:  # the graph narrows search; search still works without it
        log.warning("graph lookup skipped: %s", e)
        related = {}

    ids = [i for i in dict.fromkeys(list(fused) + list(related)) if i not in exclude]
    candidates = [c for c in _rows(conn, ids, asset_id) if asset_id is None or c["on_asset"]]
    if not candidates:
        return []

    q_codes = {t for t in tokenize(query + " " + " ".join(boost_terms)) if is_code(t)}
    rerank = index.rerank(query or " ".join(boost_terms), [index.index_text(c) for c in candidates])
    results = []
    for c, rr in zip(candidates, rerank):
        shared = q_codes & {t for t in tokenize(index.index_text(c)) if is_code(t)}
        g = related.get(c["id"])
        if rr < MIN_RERANK and not shared and not g:
            continue
        score = rr + CODE_BOOST * len(shared) + (GRAPH_BOOST * g["hits"] if g else 0.0)
        if c["kind"] == "fixnote" and c["on_asset"]:
            score += FIXNOTE_BOOST
        results.append({**c, "score": round(score, 3), "rerank": round(rr, 3),
                        "codes": sorted(shared), "graph": g["via"] if g else [],
                        "fused": round(fused.get(c["id"], 0.0), 4)})
    results.sort(key=lambda r: r["score"], reverse=True)
    return results[:k]
