#!/usr/bin/env bash
set -euo pipefail

# deploy.sh - despliega la aplicación en un VPS Ubuntu
# Uso: sudo bash deploy.sh <git-repo-url> [branch]
# Ejemplo: sudo bash deploy.sh https://github.com/tu-usuario/api-to-do-qa.git main

REPO_URL="${1:-}"
BRANCH="${2:-main}"
APP_DIR="/opt/api-to-do-qa"
DOMAIN="bughunterssite.com"

if [ -z "$REPO_URL" ]; then
  echo "Uso: sudo bash $0 <git-repo-url> [branch]"
  exit 1
fi

echo "==> Desplegando repo: $REPO_URL (branch: $BRANCH) en $APP_DIR"

# Instalar Docker si no está presente (soporta Ubuntu/Debian)
if ! command -v docker >/dev/null 2>&1; then
  echo "==> Instalando Docker y docker compose plugin..."
  apt-get update
  apt-get install -y ca-certificates curl gnupg lsb-release
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /usr/share/keyrings/docker-archive-keyring.gpg
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/docker-archive-keyring.gpg] https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" \
    | tee /etc/apt/sources.list.d/docker.list > /dev/null
  apt-get update
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin git
fi

# Crear directorio de la app y ajustar permisos
mkdir -p "$APP_DIR"
chown "$SUDO_USER":"$SUDO_USER" "$APP_DIR" || true
cd "$APP_DIR"

# Clonar o actualizar el repo
if [ -d .git ]; then
  echo "==> El repo ya existe en $APP_DIR — actualizando desde origin/$BRANCH"
  git fetch --all --prune
  git reset --hard "origin/$BRANCH"
else
  echo "==> Clonando $REPO_URL ..."
  git clone --branch "$BRANCH" "$REPO_URL" .
fi

# Asegurar que Caddyfile contiene el dominio correcto
if [ -f Caddyfile ]; then
  sed -i "s/example.com/$DOMAIN/g" Caddyfile || true
  echo "==> Caddyfile actualizado con dominio: $DOMAIN"
else
  echo "==> Aviso: no se encontró Caddyfile en el repo clonado"
fi

# Levantar (build + up) con docker compose
echo "==> Construyendo y levantando contenedores (docker compose up -d --build)"
docker compose up -d --build

echo "==> Despliegue completado. Revisa logs con: sudo docker compose logs -f caddy" 

echo "Si Caddy aún no obtiene el certificado, asegúrate de que el dominio $DOMAIN apunte a esta IP y que los puertos 80/443 estén accesibles." 
