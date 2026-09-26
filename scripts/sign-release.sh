#!/bin/sh
# SPDX-FileCopyrightText: 2026 Hoang Pham
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# Signs the release archive with the Nextcloud app certificate and prints the
# two signatures the App Store asks for. Signing runs in the test fixture, so
# no other Nextcloud installation is needed.
# Usage: scripts/sign-release.sh /path/to/certificates
#        (the directory holds virtualoffice.key and virtualoffice.crt)
set -eu
cd "$(dirname "$0")/.."
CERT_DIR=$(cd "${1:?Usage: scripts/sign-release.sh /path/to/certificates}" && pwd)
KEY=$CERT_DIR/virtualoffice.key
CRT=$CERT_DIR/virtualoffice.crt
[ -r "$KEY" ] && [ -r "$CRT" ] || { echo "Missing $KEY or $CRT" >&2; exit 1; }
VERSION=$(node -p "require('./package.json').version")
UNSIGNED=build/artifacts/virtualoffice-$VERSION.tar.gz
SIGNED=build/artifacts/virtualoffice-$VERSION-signed.tar.gz
SIGNED_TEMP=$SIGNED.tmp.$$
FIXTURE="docker compose -f tests/fixture/compose.yaml"

# The certificate must belong to this key.
if [ "$(openssl x509 -in "$CRT" -noout -pubkey | openssl sha256)" != "$(openssl pkey -in "$KEY" -pubout | openssl sha256)" ]; then
    echo "virtualoffice.crt does not match virtualoffice.key" >&2
    exit 1
fi

npm run build >/dev/null
npm run package >/dev/null
if ! $FIXTURE exec -T app true 2>/dev/null; then
    tests/fixture/setup.sh polling >/dev/null
fi

cleanup() {
    $FIXTURE exec -T app rm -rf /tmp/vo-sign >/dev/null 2>&1 || true
    rm -rf build/release
    rm -f "$SIGNED_TEMP"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

rm -f "$SIGNED"
rm -rf build/release
mkdir -p build/release
tar -xzf "$UNSIGNED" -C build/release
# Sign a copy inside the fixture; the key is removed again right after.
$FIXTURE exec -T app rm -rf /tmp/vo-sign
$FIXTURE exec -T app mkdir -p /tmp/vo-sign
$FIXTURE cp build/release/virtualoffice app:/tmp/vo-sign/virtualoffice >/dev/null
$FIXTURE cp "$KEY" app:/tmp/vo-sign/app.key >/dev/null
$FIXTURE cp "$CRT" app:/tmp/vo-sign/app.crt >/dev/null
$FIXTURE exec -T app chown -R www-data:www-data /tmp/vo-sign
status=0
$FIXTURE exec -T -u www-data app php occ integrity:sign-app \
    --privateKey=/tmp/vo-sign/app.key --certificate=/tmp/vo-sign/app.crt --path=/tmp/vo-sign/virtualoffice || status=$?
$FIXTURE exec -T app rm -f /tmp/vo-sign/app.key
[ $status -eq 0 ] || exit $status
$FIXTURE exec -T -u www-data app php occ integrity:check-app \
    --path=/tmp/vo-sign/virtualoffice virtualoffice
$FIXTURE cp app:/tmp/vo-sign/virtualoffice/appinfo/signature.json build/release/virtualoffice/appinfo/signature.json >/dev/null

COPYFILE_DISABLE=1 tar --no-xattrs -czf "$SIGNED_TEMP" -C build/release virtualoffice
tar -tzf "$SIGNED_TEMP" | grep -qx 'virtualoffice/appinfo/signature.json'
mv "$SIGNED_TEMP" "$SIGNED"

echo "Signed archive: $SIGNED"
echo "SHA-256: $(openssl sha256 -r "$SIGNED" | cut -d' ' -f1)"
echo
echo "App ID signature (App Store registration):"
printf %s virtualoffice | openssl dgst -sha512 -sign "$KEY" | openssl base64 -A
echo
echo
echo "Archive signature (App Store release upload):"
openssl dgst -sha512 -sign "$KEY" "$SIGNED" | openssl base64 -A
echo
