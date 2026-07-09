#!/usr/bin/env bash
set -euo pipefail

APP_DIR="/opt/mailoutreach-ai"
SERVICE_NAME="mailoutreach-ai"
NGINX_CONF_SOURCE="$APP_DIR/deploy/nginx-mailoutreach-ai.conf"
NGINX_CONF_TARGET="/etc/nginx/sites-available/$SERVICE_NAME"
SYSTEMD_SOURCE="$APP_DIR/deploy/mailoutreach-ai.service"
SYSTEMD_TARGET="/etc/systemd/system/$SERVICE_NAME.service"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run this script as root."
  exit 1
fi

echo "Updating package lists..."
apt-get update

echo "Installing base packages..."
apt-get install -y nginx curl ca-certificates

if ! command -v node >/dev/null 2>&1; then
  echo "Installing Node.js 22.x..."
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

if ! id -u www-data >/dev/null 2>&1; then
  echo "Expected www-data user to exist, but it does not."
  exit 1
fi

if [[ ! -d "$APP_DIR" ]]; then
  echo "App directory not found: $APP_DIR"
  echo "Copy the project to $APP_DIR first, then rerun this script."
  exit 1
fi

if [[ ! -f "$APP_DIR/.env" ]]; then
  echo "Missing $APP_DIR/.env"
  echo "Create it from .env.example before continuing."
  exit 1
fi

echo "Setting ownership for $APP_DIR..."
chown -R www-data:www-data "$APP_DIR"

echo "Installing systemd service..."
cp "$SYSTEMD_SOURCE" "$SYSTEMD_TARGET"
systemctl daemon-reload
systemctl enable "$SERVICE_NAME"
systemctl restart "$SERVICE_NAME"

echo "Installing Nginx site..."
cp "$NGINX_CONF_SOURCE" "$NGINX_CONF_TARGET"
ln -sf "$NGINX_CONF_TARGET" "/etc/nginx/sites-enabled/$SERVICE_NAME"
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx

echo
echo "Bootstrap complete."
echo "Next steps:"
echo "1. Point your domain to this droplet"
echo "2. Run: certbot --nginx -d yourdomain.com"
echo "3. Set TRACKING_HOST in .env to yourdomain.com"
echo "4. Verify the app through Nginx"
