#!/usr/bin/env bash
# Restore an exported library into the Railway stores.
#
# This is the Railway counterpart to restore_library.sh (which targets the docker-compose stack).
# Railway's managed Postgres has no public URL and there is no scp, so instead of copying files to
# a server this streams straight into each service's own container over `railway ssh`:
#   - PostgreSQL   -> the Postgres container's bundled psql
#   - file store   -> tar, unpacked onto the api service's /data volume
#   - Qdrant+Neo4j -> rebuilt from PostgreSQL by app.rebuild, run inside the api container
# No local psql and no public database URL are required.
#
# On the machine that ingested the manuals:
#   bash deploy/export_library.sh                 # writes foreman-library.tar.gz
#   railway login                                 # once
#   railway link                                  # link the foreman project/environment
#   railway ssh keys add                          # once, register an SSH key with Railway
#   bash deploy/railway_restore.sh foreman-library.tar.gz
set -euo pipefail
cd "$(dirname "$0")/.."

ARCHIVE=${1:-foreman-library.tar.gz}
PG_SERVICE=${PG_SERVICE:-Postgres}   # the managed Postgres service name
API_SERVICE=${API_SERVICE:-api}
WEB_SERVICE=${WEB_SERVICE:-web}
PG_USER=${PG_USER:-postgres}
PG_DB=${PG_DB:-railway}

[ -f "$ARCHIVE" ] || { echo "No archive at '$ARCHIVE'. Run deploy/export_library.sh first."; exit 1; }
railway whoami >/dev/null 2>&1 || { echo "Not logged in. Run: railway login"; exit 1; }
railway status  >/dev/null 2>&1 || { echo "No project linked. Run: railway link"; exit 1; }
railway ssh keys list 2>/dev/null | grep -qi "SHA256" || {
  echo "No SSH key registered with Railway. Run: railway ssh keys add"; exit 1; }

# railway ssh tunnels through ssh.railway.com; trust its host key so non-interactive ssh won't fail.
ssh-keygen -F ssh.railway.com >/dev/null 2>&1 || ssh-keyscan ssh.railway.com >> ~/.ssh/known_hosts 2>/dev/null

WORK=$(mktemp -d); trap 'rm -rf "$WORK"' EXIT
tar -xzf "$ARCHIVE" -C "$WORK"
[ -f "$WORK/foreman.sql" ] && [ -f "$WORK/data.tar.gz" ] || {
  echo "Archive is missing foreman.sql or data.tar.gz — is it a foreman export?"; exit 1; }

echo "==> Restoring PostgreSQL into '$PG_SERVICE' (database: $PG_DB)"
# The dump assigns ownership to the 'foreman' role from the compose stack; create it here (no login)
# so OWNER/GRANT lines apply cleanly. ON_ERROR_STOP=0 keeps benign --clean DROP notices non-fatal.
{
  printf "%s\n" "DO \$do\$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='foreman') THEN CREATE ROLE foreman; END IF; END \$do\$;"
  cat "$WORK/foreman.sql"
} | railway ssh -s "$PG_SERVICE" -- psql -v ON_ERROR_STOP=0 -U "$PG_USER" -d "$PG_DB" >/dev/null
echo "    done."

echo "==> Unpacking the file store onto '$API_SERVICE':/data"
railway ssh -s "$API_SERVICE" -- sh -c 'cd /data && tar -xzf -' < "$WORK/data.tar.gz"
echo "    done."

echo "==> Rebuilding the Qdrant index and the Neo4j graph from PostgreSQL"
railway ssh -s "$API_SERVICE" -- sh -lc 'cd /srv && python -m app.rebuild'

echo "==> Stats"
WEB_DOMAIN=$(railway variables -s "$WEB_SERVICE" --json 2>/dev/null \
  | python3 -c "import sys,json;print(json.load(sys.stdin).get('RAILWAY_PUBLIC_DOMAIN',''))" 2>/dev/null || true)
if [ -n "${WEB_DOMAIN:-}" ]; then
  echo "    https://$WEB_DOMAIN/api/stats"
  curl -s "https://$WEB_DOMAIN/api/stats" && echo
else
  echo "    Open your web service URL and check /api/stats"
fi
