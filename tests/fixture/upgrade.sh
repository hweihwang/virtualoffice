#!/bin/sh
# SPDX-FileCopyrightText: 2026 Hoang Pham
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# Upgrades a clean Nextcloud 35 from one release archive to another with data
# in place, then checks that the data survived and the new release works.
# Usage: tests/fixture/upgrade.sh build/artifacts/virtualoffice-1.0.0-signed.tar.gz build/artifacts/virtualoffice-1.1.0.tar.gz
set -eu
OLD=$(cd "$(dirname "$1")" && pwd)/$(basename "$1")
NEW=$(cd "$(dirname "$2")" && pwd)/$(basename "$2")
IMAGE=nextcloud:35-apache@sha256:23c101539e295aaf83888c9c1cae7df3fb6ce80b9ea9310248dad46af8c89936
PASS=virtualoffice-fixture-only
PORT=18941
NAME=vo-upgrade
BASE=http://localhost:$PORT
API=$BASE/ocs/v2.php/apps/virtualoffice/api/v1
HERE=$(cd "$(dirname "$0")" && pwd)
status=0
ok() { echo "ok   $1"; }
fail() { echo "FAIL $1"; status=1; }
occ() { docker exec -u www-data -e NC_PASS=$PASS $NAME php occ "$@"; }
call() { user=$1; method=$2; path=$3; shift 3; curl -s -u "$user:$PASS" -H 'OCS-APIRequest: true' -H 'Accept: application/json' -H 'Content-Type: application/json' -X "$method" "$API$path" "$@"; }
json() { python3 -c "import json,sys; d=json.load(sys.stdin)['ocs']['data']; print($1)"; }
install() {
    docker exec $NAME sh -c 'rm -rf /var/www/html/custom_apps/virtualoffice'
    docker cp "$1" $NAME:/tmp/app.tar.gz
    docker exec $NAME sh -c 'tar -xzf /tmp/app.tar.gz -C /var/www/html/custom_apps && chown -R www-data:www-data /var/www/html/custom_apps/virtualoffice'
}

docker rm -f $NAME >/dev/null 2>&1 || true
docker run -d --name $NAME -p 127.0.0.1:$PORT:80 -e NEXTCLOUD_ADMIN_USER=admin -e NEXTCLOUD_ADMIN_PASSWORD=$PASS -e NEXTCLOUD_TRUSTED_DOMAINS=localhost -e SQLITE_DATABASE=nextcloud $IMAGE >/dev/null
until curl -fs $BASE/status.php 2>/dev/null | grep -q '"installed":true'; do sleep 3; done
sleep 5
install "$OLD"
occ app:enable virtualoffice >/dev/null
occ config:system:set ratelimit.protection.enabled --value=false --type=boolean >/dev/null
occ group:add staff >/dev/null
for u in alice bao chi dan; do occ user:add --password-from-env $u >/dev/null; done
for u in alice bao dan; do occ group:adduser staff $u; done
echo "== before: $(occ app:list | grep virtualoffice)"

# Data from the old release: an office with decor, a desk, preferences and someone inside.
TOKEN=$(call admin POST /offices -d '{"title":"Upgrade office","audience":{"kind":"group","id":"staff"},"managerUid":"alice"}' | json "d['token']")
REV=$(call alice GET /offices/$TOKEN | json "d['revision']")
curl -s -o /dev/null -u alice:$PASS -H 'OCS-APIRequest: true' -H 'Content-Type: application/json' -H "If-Match: \"$REV\"" -X PATCH "$API/offices/$TOKEN" -d '{"decor":{"floor":"mint","rug":"ocean"}}'
call bao PUT /offices/$TOKEN/desks/d7 >/dev/null
call alice PUT /me/preferences -d '{"revision":0,"preferences":{"appearance":{"creature":"cat","palette":"rose","accessory":"scarf"},"ui":{"view":"list","reducedEffects":true,"announcements":false}}}' >/dev/null
SESSION=0123456789abcdef0123456789abcdef
call alice POST /offices/$TOKEN/room/enter -d "{\"session\":\"$SESSION\"}" >/dev/null

install "$NEW"
occ upgrade >/dev/null
# An App Store update resets PHP's opcache; restart Apache for the same effect.
docker exec $NAME apachectl -k graceful 2>/dev/null
sleep 3
echo "== after: $(occ app:list | grep virtualoffice)"

OFFICE=$(call alice GET /offices/$TOKEN)
[ "$(echo "$OFFICE" | json "d['title']")" = "Upgrade office" ] && ok "office kept" || fail "office kept"
[ "$(echo "$OFFICE" | json "d['layoutId'] + ' ' + str(d['capacity'])")" = "starter-office-v1 32" ] && ok "office keeps the large layout" || fail "layout"
[ "$(echo "$OFFICE" | json "d['config']['decor']['floor'] + ' ' + d['config']['decor']['rug'] + ' ' + d['config']['decor']['season']")" = "mint ocean none" ] && ok "decor kept, season added" || fail "decor"
[ "$(call bao GET /offices/$TOKEN/desks | json "','.join(x['deskId'] for x in d['desks'])")" = "d7" ] && ok "desk kept" || fail "desk"
[ "$(call alice GET /me/preferences | json "d['preferences']['appearance']['creature'] + ' ' + d['preferences']['ui']['view'] + ' ' + str(d['preferences']['ui']['musicVolume'])")" = "cat list 50" ] && ok "preferences kept, sound defaults added" || fail "preferences"
# The person inside keeps their presence; the new voice column defaults to off.
POLL=$(call alice GET "/offices/$TOKEN/room?session=$SESSION&rev=0")
[ "$(echo "$POLL" | json "str([p['voice'] for p in d['participants'] if p['uid'] == 'alice'])")" = "[None]" ] && ok "presence kept, voice off" || fail "presence"
[ "$(echo "$POLL" | json "str(d['voiceAllowed']) + ' ' + str(d['music'])")" = "True None" ] && ok "voice allowed, no music" || fail "voice and music state"
call alice POST /offices/$TOKEN/room/leave -d "{\"session\":\"$SESSION\"}" >/dev/null
# The smoke test also signals between two people, which needs the new table.
if node "$HERE/smoke.mjs" $BASE; then :; else status=1; fi
[ "${KEEP:-}" = 1 ] || docker rm -f $NAME >/dev/null 2>&1 || true
exit $status
