#!/usr/bin/env bash
# Provision and deploy Foreman on Railway.
#
#   railway login          # once, interactively (browser)
#   bash deploy/railway.sh # from the repo root
#
# Railway terminates TLS and gives the web service a public https domain, so the Caddy
# service from docker-compose.prod.yml is not used here. The stack becomes five services:
# managed Postgres, Qdrant, Neo4j, the API (backend/), and the web app (frontend/).
#
# As with the docker-compose demo, the API image has no Docling: uploading a document on
# the server fails on purpose. Answer from a library ingested at home and restored here
# (deploy/export_library.sh / deploy/restore_library.sh).
set -euo pipefail

PROJECT_NAME="${PROJECT_NAME:-foreman}"
NEO4J_PASSWORD="${NEO4J_PASSWORD:-$(openssl rand -hex 16)}"
ANTHROPIC_API_KEY="${ANTHROPIC_API_KEY:-}"       # omit for extractive mode (costs nothing)
ANTHROPIC_WORKSPACE_ID="${ANTHROPIC_WORKSPACE_ID:-}"
FOREMAN_RATE_LIMIT="${FOREMAN_RATE_LIMIT:-30}"   # questions per hour per visitor; 0 removes the cap

railway whoami >/dev/null 2>&1 || { echo "Run 'railway login' first."; exit 1; }

echo "==> Project"
railway init --name "$PROJECT_NAME" >/dev/null

echo "==> Postgres (managed)"
railway add --database postgres

echo "==> Qdrant"
railway add --service qdrant --image qdrant/qdrant:v1.19.1 \
  --variables "QDRANT__SERVICE__HOST=::"
railway volume add --service qdrant --mount-path /qdrant/storage

echo "==> Neo4j"
railway add --service neo4j --image neo4j:5-community \
  --variables "NEO4J_AUTH=neo4j/${NEO4J_PASSWORD}" \
  --variables "NEO4J_server_default__listen__address=::" \
  --variables "NEO4J_server_memory_heap_max__size=512M" \
  --variables "NEO4J_server_memory_pagecache_size=256M"
railway volume add --service neo4j --mount-path /data

echo "==> API"
railway add --service api \
  --variables "DATABASE_URL=\${{Postgres.DATABASE_URL}}" \
  --variables "QDRANT_URL=http://qdrant.railway.internal:6333" \
  --variables "NEO4J_URI=bolt://neo4j.railway.internal:7687" \
  --variables "NEO4J_PASSWORD=${NEO4J_PASSWORD}" \
  --variables "FOREMAN_RATE_LIMIT=${FOREMAN_RATE_LIMIT}" \
  --variables "FOREMAN_SEED=0" \
  --variables "ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}" \
  --variables "ANTHROPIC_WORKSPACE_ID=${ANTHROPIC_WORKSPACE_ID}"
railway volume add --service api --mount-path /data

echo "==> Web"
railway add --service web \
  --variables "FOREMAN_API_URL=http://api.railway.internal:8000"

echo "==> Deploy API (build context: backend/)"
railway up ./backend --service api --path-as-root --ci

echo "==> Deploy Web (build context: frontend/)"
railway up ./frontend --service web --path-as-root --ci

echo "==> Public domain for the web service"
railway domain --service web

cat <<EOF

Done. Two things remain:
  1. The library is empty until you restore it. On the machine where you ingested manuals:
       bash deploy/export_library.sh
     then load it into these managed stores (see DEPLOY.md; the Railway equivalent uses
     'railway connect' / the service's DATABASE_URL rather than scp).
  2. Neo4j password for this deploy: ${NEO4J_PASSWORD}
EOF
