#!/usr/bin/env bash
# Run on the machine that ingested the manuals. Produces foreman-library.tar.gz:
# the PostgreSQL contents plus the file store (page images, PDFs, photos).
#
#   bash deploy/export_library.sh
set -euo pipefail
cd "$(dirname "$0")/.."

OUT=${1:-foreman-library.tar.gz}
PG_CONTAINER=${PG_CONTAINER:-foreman-postgres-1}
WORK=$(mktemp -d)

echo "Dumping PostgreSQL from $PG_CONTAINER"
docker exec "$PG_CONTAINER" pg_dump -U foreman --clean --if-exists foreman > "$WORK/foreman.sql"

echo "Collecting the file store"
tar -czf "$WORK/data.tar.gz" -C backend/data pages files uploads 2>/dev/null || \
  tar -czf "$WORK/data.tar.gz" -C backend/data pages files

tar -czf "$OUT" -C "$WORK" foreman.sql data.tar.gz
rm -rf "$WORK"
echo "Wrote $OUT ($(du -h "$OUT" | cut -f1))"
echo "Copy it to the server:  scp $OUT root@SERVER:/opt/foreman/"
