#!/usr/bin/env bash
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-backups}"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
DB_HOST="${ZDM_DB_HOST:-127.0.0.1}"
DB_PORT="${ZDM_DB_PORT:-3306}"
DB_NAME="${ZDM_DB_NAME:-zdm_admin}"
DB_USER="${ZDM_DB_USERNAME:-zdm_admin}"
DB_PASSWORD="${ZDM_DB_PASSWORD:-zdm_admin_pwd}"
DB_CONTAINER="${ZDM_DB_CONTAINER:-zdm-platform-mysql}"
OUTPUT_FILE="${BACKUP_DIR}/${DB_NAME}-${TIMESTAMP}.sql.gz"

mkdir -p "${BACKUP_DIR}"

if command -v docker >/dev/null 2>&1 && docker ps --format '{{.Names}}' | grep -qx "${DB_CONTAINER}"; then
  docker exec "${DB_CONTAINER}" mysqldump \
    --user="${DB_USER}" \
    --password="${DB_PASSWORD}" \
    --single-transaction \
    --no-tablespaces \
    --routines \
    --triggers \
    "${DB_NAME}" | gzip > "${OUTPUT_FILE}"
elif command -v mysqldump >/dev/null 2>&1; then
  mysqldump \
    --host="${DB_HOST}" \
    --port="${DB_PORT}" \
    --user="${DB_USER}" \
    --password="${DB_PASSWORD}" \
    --single-transaction \
    --no-tablespaces \
    --routines \
    --triggers \
    "${DB_NAME}" | gzip > "${OUTPUT_FILE}"
else
  echo "Neither Docker MySQL container '${DB_CONTAINER}' nor local mysqldump is available." >&2
  exit 1
fi

echo "Created ${OUTPUT_FILE}"
