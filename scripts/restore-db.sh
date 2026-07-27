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

gunzip -c "$1" | mysql \
  --host="${DB_HOST}" \
  --port="${DB_PORT}" \
  --user="${DB_USER}" \
  --password="${DB_PASSWORD}" \
  "${DB_NAME}"

echo "Restored ${DB_NAME} from $1"
