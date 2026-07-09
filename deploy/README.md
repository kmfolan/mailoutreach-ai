# Deployment Bootstrap — MailOutreach AI

This folder contains deployment assets for running MailOutreach AI on a DigitalOcean droplet.

## Files

- `mailoutreach-ai.service` — systemd service definition
- `nginx-mailoutreach-ai.conf` — Nginx reverse proxy config
- `bootstrap-ubuntu.sh` — droplet bootstrap script
- `deploy-example.sh` — rsync deploy command
- `rsync-exclude.txt` — files to skip during sync

## Expected Server Layout

- App path: `/opt/mailoutreach-ai`
- Server process: `run-server.sh`
- App port: `4021`

## Minimum Steps

1. Sync the project to `/opt/mailoutreach-ai`
2. Create `/opt/mailoutreach-ai/.env` from `.env.example`
3. Put your real secrets in `.env` (especially API keys)
4. Run `sudo bash /opt/mailoutreach-ai/deploy/bootstrap-ubuntu.sh`
5. Point a domain or subdomain at the droplet
6. Run `certbot --nginx -d yourdomain.com`
7. Set `TRACKING_HOST=yourdomain.com` in `.env` and restart

## Suggested Sync Command

```bash
./deploy/deploy-example.sh root@your-droplet-ip
```

## Required .env Keys for Production

```
AUTH_PASSWORD=strong-password
AUTH_SESSION_SECRET=64-char-random-string
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
GOOGLE_MAPS_API_KEY=AIza...
SNOV_CLIENT_ID=...
SNOV_CLIENT_SECRET=...
SMTP_HOST=smtp.office365.com
SMTP_USER=outreach@yourdomain.com
SMTP_PASS=app-password
TRACKING_HOST=yourdomain.com
COOKIE_SECURE=true
NODE_ENV=production
```
