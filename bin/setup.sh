#!/usr/bin/env sh
# PORQUÊ: setup idempotente da API + painel. Pode rodar 2 vezes sem quebrar.
# Uso: bin/setup.sh [--e2e]  (--e2e instala browsers do Playwright, pesado)
set -eu

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "ERRO: $1 não encontrado no PATH (recebido: vazio, esperado: instalado)" >&2
    exit 1
  fi
}

require_cmd node
require_cmd npm

echo "[setup] node $(node -v), npm $(npm -v)"
echo "[setup] instalando deps da API (npm ci)..."
npm ci

if [ -d "panel" ]; then
  echo "[setup] instalando deps do painel (npm ci)..."
  npm ci --prefix panel
fi

if [ "${1:-}" = "--e2e" ]; then
  echo "[setup] instalando browsers do Playwright (painel)..."
  npm --prefix panel exec playwright install --with-deps chromium
fi

echo "[setup] ok. Próximo: npm run verify"
