# Deploy OpenObserve

Deploy OpenObserve at `openobserve.hugojosefson.net` for the Deno Desktop Steam
Deck app to POST logs to for debugging.

## Requirements

- Docker and docker-compose plugin on the host
- TLS + reverse proxy already set up for `*.hugojosefson.net` pointing to this
  host (not part of this spec)

## Directory and file

Place this at `/appdata/openobserve/docker-compose.yml`:

```yaml
services:
  openobserve:
    container_name: openobserve
    image: docker.io/openobserve/openobserve:latest
    restart: unless-stopped
    ports:
      - "80:5080"
    environment:
      ZO_ROOT_USER_EMAIL: admin@hugojosefson.net
      ZO_ROOT_USER_PASSWORD: changeme
    volumes:
      - /appdata/openobserve/data:/data
```

## Start

```bash
cd /appdata/openobserve
docker compose up -d
```

The service will be reachable at `http://openobserve.hugojosefson.net:80` (port
80 internally, reverse proxy adds TLS).

## Post-deploy

1. Log into the web UI at `https://openobserve.hugojosefson.net` with the
   credentials above
2. Change the password
3. Create an API token or use basic auth for log ingestion

## Verifying

```bash
curl -X POST http://localhost/api/default/default/_json \
  -u admin@hugojosefson.net:changeme \
  -H "Content-Type: application/json" \
  -d '{"message":"hello from deploy test","level":"info"}'
```
