#!/bin/bash
# setup_node.sh

# Definir versión y plataforma
NODE_VERSION="v20.11.0"
PLATFORM="darwin-arm64"
DISTRO="node-$NODE_VERSION-$PLATFORM"
URL="https://nodejs.org/dist/$NODE_VERSION/$DISTRO.tar.gz"

echo "⏳ Descargando Node.js $NODE_VERSION para macOs ($PLATFORM)..."
curl -O $URL

echo "📦 Descomprimiendo..."
tar -xzf "$DISTRO.tar.gz"

echo "📂 Configurando entorno local (.node_bin)..."
rm -rf .node_bin
mv "$DISTRO" .node_bin
rm "$DISTRO.tar.gz"

echo "✅ Node.js instalado en .node_bin"
