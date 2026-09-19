"""Neo4j asset graph: Asset, Document, Procedure, FaultCode, Component, Part and fix notes.

    (Asset)-[:DOCUMENTED_BY]->(Document)-[:HAS_PROCEDURE]->(Procedure)-[:HAS_CHUNK]->(Chunk)
    (Procedure)-[:ADDRESSES]->(FaultCode)   (Procedure)-[:INVOLVES]->(Component)   (Procedure)-[:USES_PART]->(Part)
    (Asset)-[:HAS_FIX_NOTE]->(Chunk:FixNote)-[:ADDRESSES|INVOLVES|USES_PART]->(...)

Retrieval asks the graph which procedures touch the codes and parts in a question; the
correction loop asks it for procedures that mention both the part a step names and the
part the technician actually sees. The graph is derived from PostgreSQL and can be rebuilt.
"""
import logging

from neo4j import GraphDatabase

from . import config, db
from .entities import Entities, extract

log = logging.getLogger("foreman.graph")
_driver = None


def driver():
    global _driver
    if _driver is None:
        _driver = GraphDatabase.driver(config.NEO4J_URI, auth=(config.NEO4J_USER, config.NEO4J_PASSWORD),
                                       notifications_min_severity="OFF")
    return _driver


def close():
    global _driver
    if _driver is not None:
        _driver.close()
        _driver = None


def run(cypher: str, **params):
    records, _, _ = driver().execute_query(cypher, ns=config.GRAPH_NS, **params, database_="neo4j")
    return [r.data() for r in records]


def init():
    for label, key in [("Asset", "tag"), ("Document", "id"), ("Procedure", "key"), ("Chunk", "id"),
                       ("FaultCode", "code"), ("Component", "name"), ("Part", "number")]:
        run(f"CREATE INDEX {label.lower()}_ns_{key} IF NOT EXISTS FOR (n:{label}) ON (n.ns, n.{key})")


def wipe():
    run("MATCH (n {ns: $ns}) DETACH DELETE n")


def upsert_asset(tag: str, name: str):
    run("MERGE (a:Asset {ns: $ns, tag: $tag}) SET a.name = $name", tag=tag, name=name)


def link_assets(document_id: int, tags: list[str]):
    run("MATCH (:Asset {ns: $ns})-[r:DOCUMENTED_BY]->(:Document {ns: $ns, id: $id}) DELETE r", id=document_id)
    run("""MATCH (d:Document {ns: $ns, id: $id}) UNWIND $tags AS tag
           MATCH (a:Asset {ns: $ns, tag: tag}) MERGE (a)-[:DOCUMENTED_BY]->(d)""", id=document_id, tags=tags)


def _ents(e: Entities) -> dict:
    return {"faults": sorted(e.faults), "components": sorted(e.components), "parts": sorted(e.parts)}


_LINK = """
FOREACH (f IN $faults | MERGE (n:FaultCode {ns: $ns, code: f}) MERGE (x)-[:ADDRESSES]->(n))
FOREACH (c IN $components | MERGE (n:Component {ns: $ns, name: c}) MERGE (x)-[:INVOLVES]->(n))
FOREACH (p IN $parts | MERGE (n:Part {ns: $ns, number: p}) MERGE (x)-[:USES_PART]->(n))
"""


def index_document(conn, document_id: int):
    """(Re)build one document's procedures, chunks and entities from PostgreSQL."""
    delete_document(document_id)
    d = db.row(conn.execute("SELECT id, title, version FROM documents WHERE id=%s", (document_id,)).fetchone())
    if d is None:
        return
    run("MERGE (d:Document {ns: $ns, id: $id}) SET d.title = $title, d.version = $version",
        id=d["id"], title=d["title"], version=d["version"])
    tags = [r["tag"] for r in conn.execute(
        "SELECT a.tag FROM assets a JOIN document_assets da ON da.asset_id=a.id WHERE da.document_id=%s", (document_id,))]
    for a in conn.execute("SELECT a.tag, a.name FROM assets a JOIN document_assets da ON da.asset_id=a.id "
                          "WHERE da.document_id=%s", (document_id,)):
        upsert_asset(a["tag"], a["name"])
    link_assets(document_id, tags)

    procedures: dict[str, dict] = {}
    for c in conn.execute("SELECT id, section, page_no, text FROM chunks WHERE document_id=%s ORDER BY page_no, id",
                          (document_id,)):
        key = f"{document_id}|{c['section']}"
        p = procedures.setdefault(key, {"key": key, "title": c["section"] or "(untitled)", "page": c["page_no"],
                                        "chunks": [], "ents": Entities()})
        p["chunks"].append(c["id"])
        found = extract(c["text"], c["section"])
        p["ents"].faults |= found.faults
        p["ents"].components |= found.components
        p["ents"].parts |= found.parts
    for p in procedures.values():
        run("""MATCH (d:Document {ns: $ns, id: $doc})
               MERGE (x:Procedure {ns: $ns, key: $key}) SET x.title = $title, x.page = $page, x.document_id = $doc
               MERGE (d)-[:HAS_PROCEDURE]->(x)
               WITH x UNWIND $chunks AS cid
               MERGE (c:Chunk {ns: $ns, id: cid}) MERGE (x)-[:HAS_CHUNK]->(c)""",
            doc=document_id, key=p["key"], title=p["title"], page=p["page"], chunks=p["chunks"])
        run("MATCH (x:Procedure {ns: $ns, key: $key})" + _LINK, key=p["key"], **_ents(p["ents"]))


def add_fix_note(chunk_id: int, asset_tag: str | None, text: str, section: str):
    run("MERGE (c:Chunk:FixNote {ns: $ns, id: $id})", id=chunk_id)
    if asset_tag:
        run("MATCH (a:Asset {ns: $ns, tag: $tag}), (c:Chunk {ns: $ns, id: $id}) MERGE (a)-[:HAS_FIX_NOTE]->(c)",
            tag=asset_tag, id=chunk_id)
    run("MATCH (x:Chunk {ns: $ns, id: $id})" + _LINK, id=chunk_id, **_ents(extract(text + "\n" + section, loose=True)))


def delete_document(document_id: int):
    run("""MATCH (d:Document {ns: $ns, id: $id})
           OPTIONAL MATCH (d)-[:HAS_PROCEDURE]->(p)
           OPTIONAL MATCH (p)-[:HAS_CHUNK]->(c)
           DETACH DELETE c, p, d""", id=document_id)


def related_chunks(ents: Entities, asset_tag: str | None, library_wide: bool = False) -> dict[int, dict]:
    """Chunks of procedures (and fix notes) linked to the given entities.

    Returns {chunk_id: {"hits": n entities matched, "via": [...], "procedure": title}}.
    Scoped to the asset's documents unless `library_wide`."""
    if not ents:
        return {}
    params = dict(faults=sorted(ents.faults), components=sorted(ents.components), parts=sorted(ents.parts),
                  tag=asset_tag, wide=library_wide or asset_tag is None)
    rows = run("""
        MATCH (x {ns: $ns})-[:ADDRESSES|INVOLVES|USES_PART]->(e {ns: $ns})
        WHERE (x:Procedure OR x:FixNote)
          AND ((e:FaultCode AND e.code IN $faults) OR (e:Component AND e.name IN $components)
               OR (e:Part AND e.number IN $parts))
        WITH x, collect(DISTINCT coalesce(e.code, e.name, e.number)) AS via
        OPTIONAL MATCH (a:Asset {ns: $ns, tag: $tag})-[:DOCUMENTED_BY]->(:Document)-[:HAS_PROCEDURE]->(x)
        OPTIONAL MATCH (b:Asset {ns: $ns, tag: $tag})-[:HAS_FIX_NOTE]->(x)
        WITH x, via, (a IS NOT NULL OR b IS NOT NULL) AS on_asset
        WHERE $wide OR on_asset
        OPTIONAL MATCH (x)-[:HAS_CHUNK]->(c:Chunk)
        RETURN coalesce(c.id, x.id) AS chunk_id, size(via) AS hits, via, coalesce(x.title, 'Fix note') AS procedure
    """, **params)
    out: dict[int, dict] = {}
    for r in rows:
        if r["chunk_id"] is None:
            continue
        cur = out.get(r["chunk_id"])
        if cur is None or r["hits"] > cur["hits"]:
            out[r["chunk_id"]] = {"hits": r["hits"], "via": r["via"], "procedure": r["procedure"]}
    return out


def rebuild(conn):
    wipe()
    init()
    for a in conn.execute("SELECT tag, name FROM assets"):
        upsert_asset(a["tag"], a["name"])
    for d in conn.execute("SELECT id FROM documents WHERE status='ready'").fetchall():
        index_document(conn, d["id"])
    for c in conn.execute("SELECT c.id, c.text, c.section, a.tag FROM chunks c LEFT JOIN assets a ON a.id=c.asset_id "
                          "WHERE c.kind='fixnote'").fetchall():
        add_fix_note(c["id"], c["tag"], c["text"], c["section"])


def stats() -> dict:
    rows = run("MATCH (n {ns: $ns}) RETURN labels(n)[0] AS label, count(*) AS n")
    return {r["label"]: r["n"] for r in rows}
