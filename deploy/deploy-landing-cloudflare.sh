#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

/usr/local/bin/npm install
/usr/local/bin/npm run build:landing

npx wrangler pages deploy landing-dist --project-name tikad-landing

echo "Deploy complete. tikad.app -> Cloudflare Pages landing"
