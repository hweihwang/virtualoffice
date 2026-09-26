#!/bin/sh
# SPDX-FileCopyrightText: 2026 Hoang Pham
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# Rebuilds every screenshot, the social preview and the demo video from a
# fresh push fixture. Needs Docker, ffmpeg, cwebp and ImageMagick.
# Usage: scripts/marketing/build.sh   (resets the test fixture)
set -eu
cd "$(dirname "$0")/../.."
FIXTURE=tests/fixture/compose.yaml
TLS=build/marketing-tls
occ() { docker compose -f $FIXTURE exec -T -u www-data app php occ "$@"; }

npm run build >/dev/null
docker compose -f $FIXTURE --profile push down -v >/dev/null 2>&1 || true
tests/fixture/setup.sh push

# A TLS proxy on 127.0.0.1:18443 serves the fixture as https://cloud.example.com.
mkdir -p $TLS
openssl req -x509 -newkey rsa:2048 -nodes -keyout $TLS/key.pem -out $TLS/cert.pem -days 2 \
    -subj /CN=cloud.example.com -addext subjectAltName=DNS:cloud.example.com 2>/dev/null
cat > $TLS/default.conf <<'NGINX'
resolver 127.0.0.11 valid=10s;
server {
    listen 443 ssl;
    ssl_certificate /tls/cert.pem;
    ssl_certificate_key /tls/key.pem;
    client_max_body_size 64m;
    location /push/ {
        set $push http://push:7867;
        rewrite ^/push/(.*)$ /$1 break;
        proxy_pass $push;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "Upgrade";
        proxy_set_header Host $host;
    }
    location / {
        proxy_pass http://app;
        proxy_set_header Host cloud.example.com;
        proxy_set_header X-Forwarded-Proto https;
        proxy_buffering off;
    }
}
NGINX
docker rm -f vo-marketing-tls >/dev/null 2>&1 || true
docker run -d --name vo-marketing-tls --network virtualoffice-validation_default -p 127.0.0.1:18443:443 \
    -v "$PWD/$TLS:/tls:ro" -v "$PWD/$TLS/default.conf:/etc/nginx/conf.d/default.conf:ro" nginx:1.29-alpine >/dev/null
occ config:system:set trusted_domains 5 --value=cloud.example.com >/dev/null
occ config:system:set overwritehost --value=cloud.example.com >/dev/null
occ config:system:set overwriteprotocol --value=https >/dev/null
occ config:system:set overwrite.cli.url --value=https://cloud.example.com >/dev/null
occ config:app:set notify_push base_endpoint --value=https://cloud.example.com/push >/dev/null

cleanup() {
    docker rm -f vo-marketing-tls >/dev/null 2>&1 || true
    occ config:system:set overwritehost --value=localhost:18935 >/dev/null
    occ config:system:delete overwriteprotocol >/dev/null
    occ config:system:set overwrite.cli.url --value=http://localhost:18935 >/dev/null
    occ config:app:set notify_push base_endpoint --value=http://localhost:18935/push >/dev/null
    rm -rf $TLS
}
trap cleanup EXIT

node scripts/marketing/capture.mjs
node scripts/marketing/render.mjs
