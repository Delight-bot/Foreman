"""Rebuild the Qdrant index and the Neo4j graph from PostgreSQL, the system of record.

    python -m app.rebuild
"""
from . import db, graph, index

if __name__ == "__main__":
    db.init()
    with db.session() as conn:
        index.rebuild(conn)
        graph.rebuild(conn)
    print(f"qdrant points: {index.count()}  neo4j nodes: {graph.stats()}")
    graph.close()
    db.close()
