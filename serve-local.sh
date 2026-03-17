#!/usr/bin/env bash
set -e
APP_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "▶ Building..."
cd "$APP_DIR"
npm run build

# Stop any previous preview container
docker stop venus-preview 2>/dev/null || true

echo "▶ Serving at http://192.168.76.171:8000"
docker run -d --rm --name venus-preview \
  -p 8000:80 \
  -v "$APP_DIR/dist:/usr/share/nginx/html:ro" \
  nginx:alpine

echo "✅ Done — open http://192.168.76.171:8000/app/?host=192.168.76.100&port=80"
