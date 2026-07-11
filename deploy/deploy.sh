#!/usr/bin/env bash
# Deploy fasola-finance on the VPS: pull, install, build, restart.
set -euo pipefail

cd "$(dirname "$0")/.."

git pull
npm ci
npm run build
sudo systemctl restart fasola-finance
sleep 2
curl -sf http://127.0.0.1:3100/healthz && echo " — deploy OK"
