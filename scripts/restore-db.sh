#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 1 ]; then
  echo "Usage: scripts/restore-db.sh backups/zdm_admin-YYYYmmdd-HHMMSS.sql.gz" >&2
  exit 1
fi

DB_HOST="${ZDM_DB_HOST:-127.0.0.1}"
DB_PORT="${ZDM_DB_PORT:-3306}"
DB_NAME="${ZDM_DB_NAME:-zdm_admin}"
DB_USER="${ZDM_DB_USERNAME:-zdm_admin}"
DB_PASSWORD="${ZDM_DB_PASSWORD:-zdm_admin_pwd}"
DB_CONTAINER="${ZDM_DB_CONTAINER:-zdm-platform-mysql}"

if command -v docker >/dev/null 2>&1 && docker ps --format '{{.Names}}' | grep -qx "${DB_CONTAINER}"; then
  gunzip -c "$1" | docker exec -i "${DB_CONTAINER}" mysql \
    --user="${DB_USER}" \
    --password="${DB_PASSWORD}" \
    "${DB_NAME}"
elif command -v mysql >/dev/null 2>&1; then
  gunzip -c "$1" | mysql \
    --host="${DB_HOST}" \
    --port="${DB_PORT}" \
    --user="${DB_USER}" \
    --password="${DB_PASSWORD}" \
    "${DB_NAME}"
else
  echo "Neither Docker MySQL container '${DB_CONTAINER}' nor local mysql client is available." >&2
  exit 1
fi

echo "Restored ${DB_NAME} from $1"
