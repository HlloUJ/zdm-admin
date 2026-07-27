#!/usr/bin/env bash
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-backups}"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
DB_HOST="${ZDM_DB_HOST:-127.0.0.1}"
DB_PORT="${ZDM_DB_PORT:-3306}"
DB_NAME="${ZDM_DB_NAME:-zdm_admin}"
DB_USER="${ZDM_DB_USERNAME:-zdm_admin}"
DB_PASSWORD="${ZDM_DB_PASSWORD:-zdm_admin_pwd}"

mkdir -p "${BACKUP_DIR}"

mysqldump \
  --host="${DB_HOST}" \
  --port="${DB_PORT}" \
  --user="${DB_USER}" \
  --password="${DB_PASSWORD}" \
  --single-transaction \
  --routines \
  --triggers \
  "${DB_NAME}" | gzip > "${BACKUP_DIR}/${DB_NAME}-${TIMESTAMP}.sql.gz"

echo "Created ${BACKUP_DIR}/${DB_NAME}-${TIMESTAMP}.sql.gz"
