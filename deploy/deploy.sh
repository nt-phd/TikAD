#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

git fetch origin main
git reset --hard origin/main
git clean -fd -e .env.production

/usr/local/bin/npm install
/usr/local/bin/npm run build:app
/usr/local/bin/npm run build:landing
sudo systemctl reload nginx
sudo systemctl restart tikad-render

echo "Deploy complete. GitHub main -> VPS"
