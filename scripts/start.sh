#!/usr/bin/env bash
set -e

cd "$(dirname "$0")/.."

# Install dependencies if needed
if [ ! -d "node_modules" ]; then
  echo "Installing dependencies..."
  npm install --legacy-peer-deps
fi

# npm 12 skips install scripts, so the database driver can be missing.
if [ ! -f "node_modules/better-sqlite3/build/Release/better_sqlite3.node" ]; then
  echo "Installing the database driver..."
  (cd node_modules/better-sqlite3 && npx prebuild-install)
fi

echo "Starting trading bot (server + client + backoffice)..."
npm run dev
