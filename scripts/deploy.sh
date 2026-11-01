#!/usr/bin/env bash
set -e

# Usage: ./scripts/deploy.sh user@your-server-ip

if [ -z "$1" ]; then
  echo "Usage: ./scripts/deploy.sh user@host"
  echo "Example: ./scripts/deploy.sh root@123.45.67.89"
  exit 1
fi

HOST="$1"
REMOTE_DIR="/opt/trading"

echo "==> Deploying to $HOST..."

# Ensure remote directory exists
ssh "$HOST" "mkdir -p $REMOTE_DIR"

# Sync project files (exclude unnecessary files)
rsync -avz --delete \
  --exclude node_modules \
  --exclude .git \
  --exclude dist \
  --exclude server/data \
  --exclude server/logs \
  --exclude '*.db' \
  --exclude .env \
  ./ "$HOST:$REMOTE_DIR/"

echo "==> Building and starting containers..."

ssh "$HOST" "cd $REMOTE_DIR/docker && docker compose up --build -d"

echo "==> Checking status..."
ssh "$HOST" "cd $REMOTE_DIR/docker && docker compose ps"

echo ""
echo "==> Deployed successfully!"
echo "    Edit env: ssh $HOST 'nano $REMOTE_DIR/docker/.env.production'"
echo "    View logs: ssh $HOST 'cd $REMOTE_DIR/docker && docker compose logs -f'"
echo "    Restart: ssh $HOST 'cd $REMOTE_DIR/docker && docker compose restart'"
echo "    Stop: ssh $HOST 'cd $REMOTE_DIR/docker && docker compose down'"
