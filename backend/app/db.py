"""PostgreSQL: the system of record for documents, pages, chunks and their provenance, assets,
answer logs, flags and fix notes. Qdrant and Neo4j are derived from these tables."""
import json
from contextlib import contextmanager

import psycopg
import psycopg.conninfo
import psycopg.sql
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb
from psycopg_pool import ConnectionPool

from . import config

SCHEMA = """
CREATE TABLE IF NOT EXISTS assets(
  id SERIAL PRIMARY KEY,
  tag TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  location TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS documents(
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  version TEXT NOT NULL DEFAULT '',
  filename TEXT NOT NULL,
  owner TEXT NOT NULL DEFAULT '',
  owner_contact TEXT NOT NULL DEFAULT '',
  page_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'processing',   -- processing | ready | failed
  error TEXT NOT NULL DEFAULT '',
  extractor TEXT NOT NULL DEFAULT '',          -- e.g. docling 2.x
  page_from INTEGER,                           -- ingest only this range of a long manual,
  page_to INTEGER,                             -- keeping the manual's own page numbers
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS document_assets(
  document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  asset_id INTEGER NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  PRIMARY KEY(document_id, asset_id)
);
CREATE TABLE IF NOT EXISTS pages(
  id SERIAL PRIMARY KEY,
  document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  page_no INTEGER NOT NULL,                     -- position in the PDF
  label TEXT NOT NULL DEFAULT '',               -- the number printed on the page, when it differs
  width REAL NOT NULL,
  height REAL NOT NULL,
  image TEXT NOT NULL,
  status TEXT NOT NULL,                         -- verified | unverified | quarantined | rejected
  confidence REAL NOT NULL DEFAULT 1.0,
  extractor TEXT NOT NULL DEFAULT '',
  reason TEXT NOT NULL DEFAULT '',
  UNIQUE(document_id, page_no)
);
CREATE TABLE IF NOT EXISTS chunks(
  id SERIAL PRIMARY KEY,
  document_id INTEGER REFERENCES documents(id) ON DELETE CASCADE,
  page_id INTEGER REFERENCES pages(id) ON DELETE CASCADE,
  page_no INTEGER,
  asset_id INTEGER REFERENCES assets(id) ON DELETE CASCADE,  -- set for fix notes
  kind TEXT NOT NULL,                           -- text | warning | table | table_row | figure | schematic | fixnote
  section TEXT NOT NULL DEFAULT '',
  label TEXT NOT NULL DEFAULT '',
  text TEXT NOT NULL,
  bbox JSONB,                                   -- [x0,y0,x1,y1] in PDF points, top-left origin
  data JSONB,                                   -- structured reading, e.g. a schematic's netlist
  extractor TEXT NOT NULL,
  confidence REAL NOT NULL DEFAULT 1.0,
  author TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS chunks_doc_section ON chunks(document_id, section);
CREATE TABLE IF NOT EXISTS queries(
  id SERIAL PRIMARY KEY,
  asset_id INTEGER REFERENCES assets(id) ON DELETE SET NULL,
  question TEXT NOT NULL,
  photo TEXT,
  understanding JSONB,
  retrieved JSONB NOT NULL,
  answer JSONB NOT NULL,
  confidence TEXT NOT NULL,
  mode TEXT NOT NULL,
  model TEXT NOT NULL DEFAULT '',
  parent_id INTEGER REFERENCES queries(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS flags(
  id SERIAL PRIMARY KEY,
  query_id INTEGER NOT NULL REFERENCES queries(id) ON DELETE CASCADE,
  step_index INTEGER NOT NULL,
  step_text TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  photo TEXT,
  outcome TEXT NOT NULL,                        -- revised | escalated
  revised_query_id INTEGER REFERENCES queries(id) ON DELETE SET NULL,
  owner TEXT NOT NULL DEFAULT '',
  owner_contact TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open',          -- open | resolved
  fix_chunk_id INTEGER REFERENCES chunks(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ
);
"""

_pool: ConnectionPool | None = None


def pool() -> ConnectionPool:
    global _pool
    if _pool is None:
        config.ensure_dirs()
        _pool = ConnectionPool(config.DATABASE_URL, min_size=1, max_size=10, open=True,
                               kwargs={"row_factory": dict_row, "autocommit": False})
    return _pool


def close() -> None:
    global _pool
    if _pool is not None:
        _pool.close()
        _pool = None


def init() -> None:
    with session() as conn:
        conn.execute(SCHEMA)
        # Columns added after the first release.
        conn.execute("ALTER TABLE documents ADD COLUMN IF NOT EXISTS page_from INTEGER, "
                     "ADD COLUMN IF NOT EXISTS page_to INTEGER")
        conn.execute("ALTER TABLE pages ADD COLUMN IF NOT EXISTS label TEXT NOT NULL DEFAULT ''")
        conn.execute("ALTER TABLE chunks ADD COLUMN IF NOT EXISTS data JSONB")


@contextmanager
def session():
    """A connection whose work is committed on success and rolled back on error."""
    with pool().connection() as conn:
        yield conn


def row(r) -> dict | None:
    return dict(r) if r is not None else None


def rows(rs) -> list[dict]:
    return [dict(r) for r in rs]


def dumps(v) -> Jsonb:
    return Jsonb(v)


def loads(v, default=None):
    """JSONB comes back already decoded; tolerate text too."""
    if v is None or v == "":
        return default
    return json.loads(v) if isinstance(v, str) else v


def reset() -> None:
    """Drop every table (demo reset and tests)."""
    with session() as conn:
        conn.execute("DROP TABLE IF EXISTS flags, queries, chunks, pages, document_assets, documents, assets CASCADE")


def ensure_database() -> None:
    """Create the configured database if it does not exist (used for the test database)."""
    info = psycopg.conninfo.conninfo_to_dict(config.DATABASE_URL)
    name = info.get("dbname")
    admin = psycopg.conninfo.make_conninfo(config.DATABASE_URL, dbname="postgres")
    with psycopg.connect(admin, autocommit=True) as c:
        if not c.execute("SELECT 1 FROM pg_database WHERE datname=%s", (name,)).fetchone():
            c.execute(psycopg.sql.SQL("CREATE DATABASE {}").format(psycopg.sql.Identifier(name)))


def connect() -> psycopg.Connection:
    """A standalone connection outside the pool (scripts and tests)."""
    return psycopg.connect(config.DATABASE_URL, row_factory=dict_row)
