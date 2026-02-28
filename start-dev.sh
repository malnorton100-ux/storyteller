#!/bin/bash
while true; do
  echo "[launcher] Starting server..."
  NODE_ENV=development npx tsx server/index.ts
  EXIT_CODE=$?
  echo "[launcher] Server exited with code $EXIT_CODE — restarting in 2s..."
  sleep 2
done
