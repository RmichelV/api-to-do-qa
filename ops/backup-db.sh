#!/usr/bin/env bash
set -euo pipefail

APP_DIR=/opt/api-to-do-qa
BACKUP_DIR=/var/backups/api-to-do-qa
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
BACKUP_FILE="$BACKUP_DIR/api_to_do_qa-$STAMP.sql.gz"
TEMP_FILE="$BACKUP_FILE.tmp"

install -d -m 700 "$BACKUP_DIR"
trap 'rm -f "$TEMP_FILE"' EXIT

docker compose --env-file "$APP_DIR/.env.production" -f "$APP_DIR/docker-compose.yml" exec -T db \
  sh -c 'mariadb-dump --user=root --password="$MARIADB_ROOT_PASSWORD" --single-transaction --routines --events --databases "$DB_NAME"' \
  | gzip -1 > "$TEMP_FILE"

mv "$TEMP_FILE" "$BACKUP_FILE"
find "$BACKUP_DIR" -type f -name 'api_to_do_qa-*.sql.gz' -mtime +14 -delete
trap - EXIT
echo "Database backup created: $BACKUP_FILE"