#!/usr/bin/env bash
docker stop venus-preview 2>/dev/null && echo "✅ Stopped" || echo "Not running"
