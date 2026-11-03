#!/usr/bin/env bash
set -euo pipefail

APP_DIR=/opt/api-to-do-qa
ENV_FILE="$APP_DIR/.env.production"

cd "$APP_DIR"
if [[ ! -e "$ENV_FILE" ]]; then
  umask 077
  root_password="$(openssl rand -hex 32)"
  app_password="$(openssl rand -hex 32)"
  migrator_password="$(openssl rand -hex 32)"
  cat > "$ENV_FILE" <<ENV
NODE_ENV=production
PORT=4000
APP_ORIGIN=https://bughunterssite.com
TRUST_PROXY=1
DB_HOST=db
DB_PORT=3306
DB_NAME=api_to_do_qa
DB_USER=qa_app
DB_PASSWORD=$app_password
MIGRATE_DB_USER=qa_migrator
MIGRATE_DB_PASSWORD=$migrator_password
DB_SSL=false
MARIADB_ROOT_PASSWORD=$root_password
# Add more comma-separated IPv4 addresses or CIDRs when additional testers need access.
DB_ALLOWED_IPS=166.114.142.97/32
ENV
  chmod 600 "$ENV_FILE"
else
  chmod 600 "$ENV_FILE"
  for key in NODE_ENV PORT APP_ORIGIN TRUST_PROXY DB_HOST DB_PORT DB_NAME DB_USER DB_PASSWORD MIGRATE_DB_USER MIGRATE_DB_PASSWORD DB_SSL MARIADB_ROOT_PASSWORD DB_ALLOWED_IPS; do
    if ! grep -q "^${key}=" "$ENV_FILE"; then
      echo "Missing $key in $ENV_FILE; refusing to overwrite existing credentials" >&2
      exit 1
    fi
  done
fi

install -m 644 ops/api-to-do-qa-db-firewall.service /etc/systemd/system/
install -m 644 ops/api-to-do-qa-db-backup.service /etc/systemd/system/
install -m 644 ops/api-to-do-qa-db-backup.timer /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now api-to-do-qa-db-firewall.service

docker compose --env-file "$ENV_FILE" config --quiet
docker compose --env-file "$ENV_FILE" up -d --build --remove-orphans

systemctl enable --now api-to-do-qa-db-backup.timer
systemctl start api-to-do-qa-db-backup.service
docker compose --env-file "$ENV_FILE" ps