#!/bin/bash
set -e
# Run this script on the VPS (ubuntu@79.72.59.32) to install Node, API and nginx.
# Usage: copy repo to VPS, then: cd stremio-skip-intro-api/deploy && bash setup-vps.sh

export DEBIAN_FRONTEND=noninteractive
sudo apt-get update
sudo apt-get install -y curl

# Node 20
if ! command -v node &>/dev/null; then
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt-get install -y nodejs
fi

# Create app dir (adjust if you deploy from git/rsync)
API_DIR="${API_DIR:-$HOME/stremio-skip-intro-api}"
mkdir -p "$API_DIR"
cd "$API_DIR"

# Install API deps if package.json exists
if [ -f package.json ]; then
    npm ci --omit=dev 2>/dev/null || npm install --omit=dev
fi

# systemd service for API
sudo tee /etc/systemd/system/stremio-skip-intro-api.service >/dev/null << 'SVC'
[Unit]
Description=Stremio Skip Intro API
After=network.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/home/ubuntu/stremio-skip-intro-api
Environment=NODE_ENV=production
Environment=PORT=3710
Environment=DB_PATH=/home/ubuntu/stremio-skip-intro-api/database.db
ExecStart=/usr/bin/node server.js
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
SVC

# Adjust paths in service if API_DIR is different
if [ "$API_DIR" != "/home/ubuntu/stremio-skip-intro-api" ]; then
    sudo sed -i "s|/home/ubuntu/stremio-skip-intro-api|$API_DIR|g" /etc/systemd/system/stremio-skip-intro-api.service
fi

sudo systemctl daemon-reload
sudo systemctl enable stremio-skip-intro-api
sudo systemctl restart stremio-skip-intro-api

# nginx (optional - install and use deploy/nginx.conf.example)
sudo apt-get install -y nginx 2>/dev/null || true
echo "API running on port 3710. Configure nginx with deploy/nginx.conf.example and set server_name to your domain, then: sudo certbot --nginx -d your-domain.com"
echo "Test: curl http://127.0.0.1:3710/health"
