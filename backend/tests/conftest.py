import os
import tempfile

import pytest

# Tests need the docker compose services running. They use their own PostgreSQL database,
# Qdrant collection and Neo4j namespace, so the demo data is never touched.
os.environ.setdefault("DATABASE_URL", "postgresql://foreman:foreman@localhost:5433/foreman_test")
os.environ["QDRANT_COLLECTION"] = "foreman_test"
os.environ["FOREMAN_GRAPH_NS"] = "test"
os.environ["FOREMAN_DATA_DIR"] = tempfile.mkdtemp(prefix="foreman-test-")
os.environ["FOREMAN_OFFLINE"] = "1"
os.environ["FOREMAN_SEED"] = "0"
os.environ["FOREMAN_SAMPLE_SHORT"] = "1"  # a 9-page manual keeps Docling quick


@pytest.fixture(scope="session")
def client():
    from fastapi.testclient import TestClient

    from app import db, sample
    from app.main import app

    db.ensure_database()
    sample.seed(reset=True)
    with TestClient(app) as c:
        yield c
