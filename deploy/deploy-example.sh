#!/usr/bin/env bash
# Usage: ./deploy/deploy-example.sh root@your-droplet-ip
set -euo pipefail

REMOTE="${1:?Usage: $0 user@host}"
APP_DIR="/opt/mailoutreach-ai"

rsync -avz --delete \
  --exclude-from="$(dirname "$0")/rsync-exclude.txt" \
  "$(dirname "$(dirname "$0")")/" \
  "$REMOTE:$APP_DIR/"

echo "Synced. Run bootstrap if this is the first deploy:"
echo "  ssh $REMOTE 'sudo bash $APP_DIR/deploy/bootstrap-ubuntu.sh'"
echo ""
echo "Or to restart after an update:"
echo "  ssh $REMOTE 'sudo systemctl restart mailoutreach-ai'"
