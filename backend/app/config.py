import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent


def _load_dotenv(path: Path) -> None:
    """KEY=VALUE lines from backend/.env; real environment variables win."""
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            key, value = line.split("=", 1)
            os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


_load_dotenv(BASE_DIR / ".env")

# PostgreSQL is the system of record; the Qdrant index and the Neo4j graph are rebuilt from it.
DATABASE_URL = os.environ.get("DATABASE_URL", "postgresql://foreman:foreman@localhost:5433/foreman")
QDRANT_URL = os.environ.get("QDRANT_URL", "http://localhost:6333")
QDRANT_COLLECTION = os.environ.get("QDRANT_COLLECTION", "foreman_chunks")
NEO4J_URI = os.environ.get("NEO4J_URI", "bolt://localhost:7687")
NEO4J_USER = os.environ.get("NEO4J_USER", "neo4j")
NEO4J_PASSWORD = os.environ.get("NEO4J_PASSWORD", "foreman-graph")
# Every graph node carries this namespace, so tests never touch the demo graph.
GRAPH_NS = os.environ.get("FOREMAN_GRAPH_NS", "foreman")

# File store: raw PDFs, rendered pages for the evidence viewer, technician photos.
DATA_DIR = Path(os.environ.get("FOREMAN_DATA_DIR", BASE_DIR / "data"))
FILES_DIR = DATA_DIR / "files"
PAGES_DIR = DATA_DIR / "pages"
UPLOADS_DIR = DATA_DIR / "uploads"

MODEL = os.environ.get("FOREMAN_MODEL", "claude-opus-5")
DENSE_MODEL = os.environ.get("FOREMAN_DENSE_MODEL", "BAAI/bge-small-en-v1.5")
SPARSE_MODEL = os.environ.get("FOREMAN_SPARSE_MODEL", "Qdrant/bm25")
RERANK_MODEL = os.environ.get("FOREMAN_RERANK_MODEL", "Xenova/ms-marco-MiniLM-L-6-v2")

# OCR'd pages below this Docling OCR score are quarantined until an owner reviews them.
OCR_MIN_CONFIDENCE = float(os.environ.get("FOREMAN_OCR_MIN_CONFIDENCE", "0.85"))


def llm_enabled() -> bool:
    """The model is used when credentials are present; otherwise Foreman runs in extractive mode."""
    if os.environ.get("FOREMAN_OFFLINE") == "1":
        return False
    if os.environ.get("FOREMAN_LLM") == "1":
        return True
    return bool(os.environ.get("ANTHROPIC_API_KEY") or os.environ.get("ANTHROPIC_AUTH_TOKEN"))


def ensure_dirs() -> None:
    for d in (DATA_DIR, FILES_DIR, PAGES_DIR, UPLOADS_DIR):
        d.mkdir(parents=True, exist_ok=True)
