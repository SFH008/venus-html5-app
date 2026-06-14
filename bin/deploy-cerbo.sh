#!/bin/bash
# deploy-cerbo.sh — build and deploy to Cerbo
# Usage: ./bin/deploy-cerbo.sh [CERBO_IP]

CERBO_IP="${1:-192.168.2.123}"

echo "🔨 Building Marine2 app..."
npm run build || { echo "❌ Build failed"; exit 1; }

echo "📦 Uploading to Cerbo at $CERBO_IP..."
rsync -av --delete dist/ root@$CERBO_IP:/data/www/app/ || { echo "❌ Upload failed"; exit 1; }

echo "✅ Done! Open http://$CERBO_IP/app/ to verify."
