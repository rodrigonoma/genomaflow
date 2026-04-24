#!/bin/sh
set -e
echo "[start] Running migrations..."
node src/db/migrate.js
echo "[start] Starting server..."
exec node src/server.js
