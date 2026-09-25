#!/bin/sh
# SPDX-FileCopyrightText: 2026 Hoang Pham
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# Installs the release archive on clean Nextcloud 35 instances with SQLite,
# MariaDB 11.4 and MySQL 8.4 and runs the smoke test on each.
# Usage: tests/fixture/matrix.sh build/artifacts/virtualoffice-1.0.0.tar.gz [sqlite mariadb mysql]
set -eu
ARCHIVE=$(cd "$(dirname "$1")" && pwd)/$(basename "$1")
shift
LANES=${*:-sqlite mariadb mysql}
IMAGE=nextcloud:35-apache@sha256:23c101539e295aaf83888c9c1cae7df3fb6ce80b9ea9310248dad46af8c89936
PASS=virtualoffice-fixture-only
HERE=$(cd "$(dirname "$0")" && pwd)
PORT=18940
status=0

for lane in $LANES; do
    name=vo-matrix-$lane
    docker rm -f $name $name-db >/dev/null 2>&1 || true
    docker network rm $name >/dev/null 2>&1 || true
    docker network create $name >/dev/null
    env="-e NEXTCLOUD_ADMIN_USER=admin -e NEXTCLOUD_ADMIN_PASSWORD=$PASS -e NEXTCLOUD_TRUSTED_DOMAINS=localhost"
    case $lane in
        sqlite) env="$env -e SQLITE_DATABASE=nextcloud" ;;
        mariadb)
            docker run -d --name $name-db --network $name -e MARIADB_ROOT_PASSWORD=$PASS -e MARIADB_DATABASE=nextcloud -e MARIADB_USER=nextcloud -e MARIADB_PASSWORD=$PASS mariadb:11.4 --transaction-isolation=READ-COMMITTED --binlog-format=ROW >/dev/null
            env="$env -e MYSQL_HOST=$name-db -e MYSQL_DATABASE=nextcloud -e MYSQL_USER=nextcloud -e MYSQL_PASSWORD=$PASS" ;;
        mysql)
            docker run -d --name $name-db --network $name -e MYSQL_ROOT_PASSWORD=$PASS -e MYSQL_DATABASE=nextcloud -e MYSQL_USER=nextcloud -e MYSQL_PASSWORD=$PASS mysql:8.4 >/dev/null
            env="$env -e MYSQL_HOST=$name-db -e MYSQL_DATABASE=nextcloud -e MYSQL_USER=nextcloud -e MYSQL_PASSWORD=$PASS" ;;
    esac
    [ "$lane" = sqlite ] || sleep 20
    # shellcheck disable=SC2086
    docker run -d --name $name --network $name -p 127.0.0.1:$PORT:80 $env $IMAGE >/dev/null
    until curl -fs http://localhost:$PORT/status.php 2>/dev/null | grep -q '"installed":true'; do sleep 3; done
    docker cp "$ARCHIVE" $name:/tmp/app.tar.gz
    docker exec $name sh -c 'tar -xzf /tmp/app.tar.gz -C /var/www/html/custom_apps && chown -R www-data:www-data /var/www/html/custom_apps/virtualoffice'
    # The image may still be finishing its first start; retry briefly.
    occ() {
        for _ in 1 2 3 4 5; do
            docker exec -u www-data -e NC_PASS=$PASS $name php occ "$@" && return 0
            sleep 3
        done
        return 1
    }
    occ app:enable virtualoffice >/dev/null
    occ config:system:set ratelimit.protection.enabled --value=false --type=boolean >/dev/null
    occ group:add staff >/dev/null
    for u in alice bao chi dan; do occ user:add --password-from-env $u >/dev/null; done
    for u in alice bao dan; do occ group:adduser staff $u; done
    echo "== $lane: $(occ status --output=json | grep -o '"versionstring":"[^"]*"') $(occ app:list | grep virtualoffice)"
    if node "$HERE/smoke.mjs" http://localhost:$PORT; then :; else status=1; fi
    [ "${KEEP:-}" = 1 ] && continue
    docker rm -f $name $name-db >/dev/null 2>&1 || true
    docker network rm $name >/dev/null 2>&1 || true
done
exit $status
