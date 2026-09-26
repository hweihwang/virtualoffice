#!/bin/sh
# SPDX-FileCopyrightText: 2026 Hoang Pham
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# Fixture setup. Usage: tests/fixture/setup.sh [push|polling]
set -eu
cd "$(dirname "$0")"
MODE=${1:-polling}
PASS=virtualoffice-fixture-only
occ() { docker compose exec -T -u www-data -e NC_PASS=$PASS app php occ "$@"; }

docker compose up -d database redis app proxy
until docker compose exec -T -u www-data app php occ status --output=json 2>/dev/null | grep -q '"installed":true'; do sleep 3; done
# The image's entrypoint keeps writing config.php after the install; wait
# until it has started Apache so our settings are not overwritten.
started=$(docker inspect -f '{{.State.StartedAt}}' "$(docker compose ps -q app)")
until docker compose logs --since "$started" app 2>/dev/null | grep -q 'AH00094'; do sleep 2; done

occ config:system:set redis host --value=redis >/dev/null
occ config:system:set redis port --value=6379 --type=integer >/dev/null
# Redis for the local cache too, so occ changes are seen by the web server at
# once. The image's apcu.config.php would override config.php.
docker compose exec -T app rm -f /var/www/html/config/apcu.config.php
docker compose exec -T app chown www-data:www-data /var/www/html/custom_apps
occ config:system:set memcache.local --value='\OC\Memcache\Redis' >/dev/null
occ config:system:set memcache.distributed --value='\OC\Memcache\Redis' >/dev/null
occ config:system:set memcache.locking --value='\OC\Memcache\Redis' >/dev/null
occ config:system:set trusted_proxies 0 --value=172.16.0.0/12 >/dev/null
occ config:system:set trusted_proxies 1 --value=192.168.0.0/16 >/dev/null
occ config:system:set overwritehost --value=localhost:18935 >/dev/null
occ config:system:set ratelimit.protection.enabled --value=false --type=boolean >/dev/null
occ app:disable firstrunwizard >/dev/null 2>&1 || true
occ app:install spreed >/dev/null 2>&1 || occ app:enable spreed >/dev/null
occ app:enable circles >/dev/null
occ app:install deck >/dev/null 2>&1 || occ app:enable deck >/dev/null
# Circles processes web changes through a loopback request; inside the
# fixture network the app container is reachable as http://app.
occ config:system:set trusted_domains 2 --value=app >/dev/null
occ config:app:set circles loopback_cloud_id --value=app >/dev/null
occ config:app:set circles loopback_cloud_scheme --value=http >/dev/null
occ app:enable virtualoffice >/dev/null
# Apply app migrations after the version changed.
occ upgrade >/dev/null

occ group:add virtualoffice-fixture >/dev/null 2>&1 || true
occ group:add virtualoffice-load >/dev/null 2>&1 || true
add_user() { occ user:info "$1" >/dev/null 2>&1 || occ user:add --password-from-env --display-name "$2" "$1" >/dev/null; }
add_user alice 'Alice'
add_user bao 'Bảo'
add_user chi 'Chi'
add_user disabled 'Disabled fixture account'
occ group:adduser virtualoffice-fixture alice >/dev/null 2>&1 || true
occ group:adduser virtualoffice-fixture bao >/dev/null 2>&1 || true
occ user:disable disabled >/dev/null 2>&1 || true
i=1
while [ $i -le 40 ]; do
    uid=$(printf 'load%02d' $i)
    add_user "$uid" "Load tester $i"
    occ group:adduser virtualoffice-load "$uid" >/dev/null 2>&1 || true
    i=$((i + 1))
done

if [ "$MODE" = push ]; then
    occ app:install notify_push >/dev/null 2>&1 || occ app:enable notify_push >/dev/null
    occ config:app:set notify_push base_endpoint --value=http://localhost:18935/push >/dev/null
    docker compose --profile push up -d push
else
    occ app:disable notify_push >/dev/null 2>&1 || true
    docker compose --profile push stop push >/dev/null 2>&1 || true
fi
echo "Fixture ready in $MODE mode at http://localhost:18935"
