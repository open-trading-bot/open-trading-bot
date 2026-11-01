#!/usr/bin/env bash
set -e

cd "$(dirname "$0")/.."

# Install dependencies if needed
if [ ! -d "node_modules" ]; then
  echo "Installing dependencies..."
  npm install --legacy-peer-deps
fi

echo "Starting trading bot (server + client + backoffice)..."
npm run dev
