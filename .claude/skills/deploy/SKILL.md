---
name: deploy
description: Deploy or run the stock screener with Docker Compose — local dev, homelab behind a reverse proxy, or VPS with auto-HTTPS (Caddy/Let's Encrypt). Use when the user asks to deploy, run docker-compose, set up production, configure HTTPS/domains, or troubleshoot container permissions.
---

# Deploying the screener (Docker Compose)


Layered Docker Compose architecture with three scenarios:

```bash
# Local development
cp .env.docker.example .env   # Add API keys for chatbot
docker-compose up

# Homelab (behind reverse proxy like Traefik/nginx proxy manager)
cp .env.docker.example .env.docker
# Edit: CORS_ORIGINS=https://stocks.home.lan
docker-compose -f docker-compose.yml -f docker-compose.prod.yml up -d

# VPS with auto-HTTPS (Hostinger, DigitalOcean, etc.)
cp .env.docker.example .env.docker
# Edit: DOMAIN=stocks.yourdomain.com, CORS_ORIGINS=https://stocks.yourdomain.com
docker-compose -f docker-compose.yml -f docker-compose.prod.yml -f docker-compose.https.yml up -d
```

**Docker files:**
- `docker-compose.yml` - Base config (local dev)
- `docker-compose.prod.yml` - Production overlay (resource limits, health checks, logging)
- `docker-compose.https.yml` - HTTPS overlay (Caddy with Let's Encrypt)
- `.env.docker.example` - Docker environment template
- `Caddyfile` - Caddy TLS configuration

**Note:** Backend runs as non-root user (uid 1000). After upgrade: `sudo chown -R 1000:1000 ./data`

