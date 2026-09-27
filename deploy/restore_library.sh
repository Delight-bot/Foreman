#!/usr/bin/env bash
# Run on the server, in the repo directory, with the stack already up.
# Loads the library exported from the ingest machine, then rebuilds the index and the graph
# from PostgreSQL, which is the system of record.
#
#   bash deploy/restore_library.sh foreman-library.tar.gz
set -euo pipefail
cd "$(dirname "$0")/.."

ARCHIVE=${1:-foreman-library.tar.gz}
COMPOSE="docker compose -f docker-compose.prod.yml"
WORK=$(mktemp -d)
tar -xzf "$ARCHIVE" -C "$WORK"

echo "Restoring PostgreSQL"
$COMPOSE exec -T postgres psql -U foreman -d foreman < "$WORK/foreman.sql"

echo "Restoring the file store"
$COMPOSE cp "$WORK/data.tar.gz" api:/data/data.tar.gz
$COMPOSE exec -T api sh -c "cd /data && tar -xzf data.tar.gz && rm data.tar.gz"

echo "Rebuilding the Qdrant index and the Neo4j graph"
$COMPOSE exec -T api python -m app.rebuild

rm -rf "$WORK"
echo "Done. Check: curl -s https://\$SITE_ADDRESS/api/stats"
