"""Neo4j asset graph: Asset, Document, Procedure, FaultCode, Component, Part, Terminal, fix notes.

    (Asset)-[:DOCUMENTED_BY]->(Document)-[:HAS_PROCEDURE]->(Procedure)-[:HAS_CHUNK]->(Chunk)
    (Procedure)-[:ADDRESSES]->(FaultCode)   (Procedure)-[:INVOLVES]->(Component)   (Procedure)-[:USES_PART]->(Part)
    (Procedure)-[:INVOLVES_TERMINAL]->(Terminal)
    (Asset)-[:HAS_FIX_NOTE]->(Chunk:FixNote)-[:ADDRESSES|INVOLVES|USES_PART]->(...)

A wiring diagram read by `schematic.py` adds the netlist itself, so connectivity is queryable
rather than buried in a picture:

    (Chunk:Schematic)-[:SHOWS]->(Terminal {ref})-[:CONNECTS_TO {wire}]->(Terminal)
    (Terminal)-[:ON_DEVICE]->(Component)

Retrieval asks the graph which procedures touch the codes and parts in a question; the
correction loop asks it for procedures that mention both the part a step names and the
part the technician actually sees; a question naming a terminal reaches the drawings that
show it and the drawings that show what it lands on. The graph is derived from PostgreSQL
and can be rebuilt.
"""
import logging

from neo4j import GraphDatabase

from . import config, db
from .entities import Entities, device_of, extract

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
                       ("FaultCode", "code"), ("Component", "name"), ("Part", "number"), ("Terminal", "ref")]:
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
    return {"faults": sorted(e.faults), "components": sorted(e.components), "parts": sorted(e.parts),
            "terminals": sorted(e.terminals)}


_LINK = """
FOREACH (f IN $faults | MERGE (n:FaultCode {ns: $ns, code: f}) MERGE (x)-[:ADDRESSES]->(n))
FOREACH (c IN $components | MERGE (n:Component {ns: $ns, name: c}) MERGE (x)-[:INVOLVES]->(n))
FOREACH (p IN $parts | MERGE (n:Part {ns: $ns, number: p}) MERGE (x)-[:USES_PART]->(n))
FOREACH (t IN $terminals | MERGE (n:Terminal {ns: $ns, ref: t}) MERGE (x)-[:INVOLVES_TERMINAL]->(n))
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
    for c in conn.execute("SELECT id, kind, section, page_no, text, data FROM chunks WHERE document_id=%s "
                          "ORDER BY page_no, id", (document_id,)):
        if c["kind"] == "schematic":
            index_schematic(c["id"], db.loads(c["data"], {}))
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


def index_schematic(chunk_id: int, reading: dict) -> None:
    """Write one drawing's netlist into the graph: terminals, their devices and the wires.

    Terminals are MERGEd by reference, so the same X4:7 read from a drawing, named in a
    bulletin and asked about by a technician is one node, and a wire drawn in one figure can
    be followed into another."""
    connections = [c for c in reading.get("connections", []) if c.get("from_ref") and c.get("to_ref")]
    refs = {t["ref"] for t in reading.get("terminals", []) if t.get("ref")}
    refs |= {r for c in connections for r in (c["from_ref"], c["to_ref"]) if ":" in r}
    if not refs:
        return
    # A terminal belongs to its device, which is the same Component node the prose talks about:
    # that is how a question about relay K3 reaches the drawing of K3:13.
    run("""MERGE (c:Chunk:Schematic {ns: $ns, id: $id})
           WITH c UNWIND $terminals AS t
           MERGE (n:Terminal {ns: $ns, ref: t.ref}) MERGE (c)-[:SHOWS]->(n)
           MERGE (d:Component {ns: $ns, name: t.device}) MERGE (n)-[:ON_DEVICE]->(d)""",
        id=chunk_id, terminals=[{"ref": r, "device": device_of(r)} for r in sorted(refs)])
    run("""UNWIND $wires AS w
           MERGE (a:Terminal {ns: $ns, ref: w.from_ref})
           MERGE (b:Terminal {ns: $ns, ref: w.to_ref})
           MERGE (a)-[r:CONNECTS_TO]-(b) SET r.wire = w.wire""",
        wires=[{"from_ref": c["from_ref"], "to_ref": c["to_ref"], "wire": c.get("wire", "")}
               for c in connections])


# A drawing that shows the terminal itself, and a drawing that shows the far end of its wire.
# One hop along CONNECTS_TO is what answers "what does X4:7 land on", even when the far end is
# drawn in a different figure in a different manual.
_SHOWS = "MATCH (c:Schematic {ns: $ns})-[:SHOWS]->(t:Terminal {ns: $ns})"
_WIRED = ("MATCH (c:Schematic {ns: $ns})-[:SHOWS]->(:Terminal {ns: $ns})"
          "-[:CONNECTS_TO]-(t:Terminal {ns: $ns})")
_SCOPED = """
    WHERE t.ref IN $refs
    OPTIONAL MATCH (a:Asset {ns: $ns, tag: $tag})-[:DOCUMENTED_BY]->(:Document)
                   -[:HAS_PROCEDURE]->(:Procedure)-[:HAS_CHUNK]->(c)
    WITH c.id AS chunk_id, t.ref AS ref, a IS NOT NULL AS on_asset
    WHERE $wide OR on_asset
    RETURN chunk_id, collect(DISTINCT ref) AS via
"""


def shown_terminals(refs: list[str], asset_tag: str | None, library_wide: bool = False) -> dict[int, dict]:
    """Chunks whose drawing shows one of these terminals, or shows what one of them lands on."""
    if not refs:
        return {}
    out: dict[int, dict] = {}
    params = dict(refs=sorted(refs), tag=asset_tag, wide=library_wide or asset_tag is None)
    for pattern, procedure in ((_SHOWS, "Wiring diagram"), (_WIRED, "Wiring diagram (other end of the wire)")):
        for r in run(pattern + _SCOPED, **params):
            cur = out.get(r["chunk_id"])
            if cur is None or len(r["via"]) > cur["hits"]:
                out[r["chunk_id"]] = {"hits": len(r["via"]), "via": r["via"], "procedure": procedure}
    return out


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
                  terminals=sorted(ents.terminals), tag=asset_tag, wide=library_wide or asset_tag is None)
    rows = run("""
        MATCH (x {ns: $ns})-[:ADDRESSES|INVOLVES|USES_PART|INVOLVES_TERMINAL]->(e {ns: $ns})
        WHERE (x:Procedure OR x:FixNote)
          AND ((e:FaultCode AND e.code IN $faults) OR (e:Component AND e.name IN $components)
               OR (e:Part AND e.number IN $parts) OR (e:Terminal AND e.ref IN $terminals))
        WITH x, collect(DISTINCT coalesce(e.code, e.name, e.number, e.ref)) AS via
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
    # A drawing showing one of the terminals, or showing the far end of its wire, is evidence
    # in its own right even when the section around it never names the terminal in prose.
    for chunk_id, hit in shown_terminals(sorted(ents.terminals), asset_tag, library_wide).items():
        cur = out.get(chunk_id)
        if cur is None or hit["hits"] > cur["hits"]:
            out[chunk_id] = hit
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
