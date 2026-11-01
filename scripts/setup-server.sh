#!/usr/bin/env bash
set -e

# Run this ON the remote server to install Docker
# Usage: ssh root@your-server 'bash -s' < scripts/setup-server.sh

echo "==> Installing Docker..."
curl -fsSL https://get.docker.com | sh

echo "==> Starting Docker..."
systemctl enable docker
systemctl start docker

echo "==> Installing Docker Compose plugin..."
apt-get update && apt-get install -y docker-compose-plugin

echo "==> Server ready! Now run: ./scripts/deploy.sh root@$(hostname -I | awk '{print $1}')"
