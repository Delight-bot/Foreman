"""Import a folder of manuals in one go, instead of uploading them one at a time.

    python -m app.import_folder ../manuals --asset ACS580
    python -m app.import_folder ../manuals --manifest ../manuals/manifest.json

A manifest gives each manual its own machine, owner and page range, which matters because
Docling reads roughly one page every few seconds on a laptop CPU: a whole 460-page manual is
hours, its fault-tracing chapter is minutes.

    [
      {"file": "acs580_firmware.pdf", "title": "ACS580 firmware manual", "version": "ABB",
       "owner": "Drives engineering", "contact": "ext. 4402", "asset": "ACS580",
       "asset_name": "ABB ACS580 drive", "location": "Line 3, MCC panel", "pages": "381-402"}
    ]

Already-imported files are skipped, so the command can be re-run after adding more PDFs.
"""
import argparse
import json
import shutil
import time
import uuid
from pathlib import Path

from . import config, db, graph, index, ingest


def _pages(spec: str | None) -> tuple[int | None, int | None]:
    if not spec:
        return None, None
    first, _, last = spec.partition("-")
    return (int(first) if first.strip() else None), (int(last) if last.strip() else None)


def _asset_id(conn, tag: str, name: str, location: str) -> int:
    tag = tag.strip().upper()
    row = conn.execute("SELECT id FROM assets WHERE tag=%s", (tag,)).fetchone()
    if row:
        return row["id"]
    new = conn.execute("INSERT INTO assets(tag, name, location) VALUES(%s,%s,%s) RETURNING id",
                       (tag, name or tag, location)).fetchone()["id"]
    graph.upsert_asset(tag, name or tag)
    print(f"  created machine {tag}")
    return new


def plan(folder: Path, manifest: Path | None, defaults: dict) -> list[dict]:
    if manifest:
        entries = json.loads(manifest.read_text(encoding="utf-8"))
    else:
        entries = [{"file": p.name} for p in sorted(folder.glob("*.pdf"))]
    jobs = []
    for e in entries:
        path = folder / e["file"]
        if not path.exists():
            print(f"  missing, skipped: {e['file']}")
            continue
        jobs.append({
            "path": path,
            "title": e.get("title") or path.stem.replace("_", " ").replace("-", " "),
            "version": e.get("version", defaults.get("version", "")),
            "owner": e.get("owner", defaults.get("owner", "")),
            "contact": e.get("contact", defaults.get("contact", "")),
            "asset": (e.get("asset") or defaults.get("asset") or "").strip().upper(),
            "asset_name": e.get("asset_name", ""),
            "location": e.get("location", ""),
            "pages": e.get("pages", defaults.get("pages")),
        })
    return jobs


def run(jobs: list[dict], dry_run: bool = False) -> None:
    db.init()
    index.init()
    graph.init()
    for n, job in enumerate(jobs, 1):
        first, last = _pages(job["pages"])
        where = f" pages {first or 1}-{last or 'end'}" if job["pages"] else ""
        print(f"[{n}/{len(jobs)}] {job['title']}{where}")
        if dry_run:
            continue
        with db.session() as conn:
            if conn.execute("SELECT 1 FROM documents WHERE title=%s AND status='ready'", (job["title"],)).fetchone():
                print("  already imported, skipped")
                continue
            filename = f"{uuid.uuid4().hex}.pdf"
            shutil.copyfile(job["path"], config.FILES_DIR / filename)
            doc_id = conn.execute(
                "INSERT INTO documents(title, version, filename, owner, owner_contact, page_from, page_to) "
                "VALUES(%s,%s,%s,%s,%s,%s,%s) RETURNING id",
                (job["title"], job["version"], filename, job["owner"], job["contact"], first, last)).fetchone()["id"]
            if job["asset"]:
                conn.execute("INSERT INTO document_assets VALUES(%s,%s) ON CONFLICT DO NOTHING",
                             (doc_id, _asset_id(conn, job["asset"], job["asset_name"], job["location"])))
        started = time.time()
        ingest.ingest_document(doc_id)
        with db.session() as conn:
            d = conn.execute("SELECT status, page_count, error FROM documents WHERE id=%s", (doc_id,)).fetchone()
            chunks = conn.execute("SELECT count(*) AS n FROM chunks WHERE document_id=%s", (doc_id,)).fetchone()["n"]
        mins = (time.time() - started) / 60
        print(f"  {d['status']}: {d['page_count']} pages, {chunks} chunks in {mins:.1f} min"
              + (f" | {d['error'][:120]}" if d["error"] else ""))


def main() -> None:
    ap = argparse.ArgumentParser(description="Ingest every PDF in a folder")
    ap.add_argument("folder", type=Path)
    ap.add_argument("--manifest", type=Path, help="JSON list with per-manual title, machine and page range")
    ap.add_argument("--asset", help="machine tag for every manual without one in the manifest")
    ap.add_argument("--owner", default="", help="document owner shown on citations and escalations")
    ap.add_argument("--contact", default="", help="owner's phone extension")
    ap.add_argument("--version", default="", help="revision, e.g. 'rev. 2019'")
    ap.add_argument("--pages", help="page range to read from each manual, e.g. 381-402")
    ap.add_argument("--dry-run", action="store_true", help="list what would be imported and stop")
    a = ap.parse_args()
    jobs = plan(a.folder, a.manifest, {"asset": a.asset, "owner": a.owner, "contact": a.contact,
                                       "version": a.version, "pages": a.pages})
    if not jobs:
        print(f"No PDFs found in {a.folder}")
        return
    run(jobs, a.dry_run)
    graph.close()
    db.close()


if __name__ == "__main__":
    main()
