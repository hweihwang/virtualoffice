<!--
  - SPDX-FileCopyrightText: 2026 Hoang Pham
  - SPDX-License-Identifier: AGPL-3.0-or-later
-->
# Releasing Virtual Office

The release archive is a custom tarball with one top-level `virtualoffice/` directory. GitHub's automatically generated source archives do not have that layout. The app supports Nextcloud 35; do not widen the version range without testing the new version.

## Prepare

1. Choose the release version in `package.json` and `appinfo/info.xml`. Add a matching `## <version>` entry to `CHANGELOG.md`.
2. Review the app metadata, links, screenshots, license notices, and changes since the previous release.
3. Run the checks and build from a clean checkout:

   ```sh
   npm ci
   composer install
   composer test:unit
   composer psalm
   composer cs:check
   npm run test:unit
   npm run typecheck
   npm run lint
   npm run build
   npm run package
   ```

4. Test the generated archive on clean Nextcloud 35 instances with `tests/fixture/matrix.sh build/artifacts/virtualoffice-<version>.tar.gz`. Run `tests/fixture/setup.sh push` followed by `npm run test:e2e`. Reset the disposable fixture with `docker compose -f tests/fixture/compose.yaml --profile push down -v`, then run `tests/fixture/setup.sh polling` and `VO_TRANSPORT=polling npm run test:e2e`. The contributor must also test the release candidate manually with Talk, Teams, Notifications, and without optional integrations. Check a fresh install, an upgrade when an older release exists, and removal of app data.

`npm run package` makes an **unsigned test archive**. Never upload it to the App Store.

## Certificate

The owner needs a Nextcloud app certificate for the `virtualoffice` app ID. Keep the private key outside this repository, readable only by the owner. Generate a 4096-bit RSA key and CSR with `CN=virtualoffice`, then submit the CSR as `virtualoffice/virtualoffice.csr` to [app-certificate-requests](https://github.com/nextcloud/app-certificate-requests) with a link to the public source repository. The contributor must open this PR and disclose AI assistance in their own words. Nextcloud returns a public `virtualoffice.crt`. Follow the [code-signing guide](https://docs.nextcloud.com/server/stable/developer_manual/app_publishing_maintenance/code_signing.html).

## Sign the exact release contents

Set `NC_OCC` to the `occ` file of a working Nextcloud installation and `CERT_DIR` to the directory containing `virtualoffice.key` and `virtualoffice.crt`. After the final build and test, extract the unsigned archive, sign the extracted app, and create a new archive:

```sh
NC_OCC=/absolute/path/to/nextcloud/occ
CERT_DIR=/absolute/path/to/certificates
rm -rf build/release
mkdir -p build/release
tar -xzf build/artifacts/virtualoffice-<version>.tar.gz -C build/release
php "$NC_OCC" integrity:sign-app \
  --privateKey="$CERT_DIR/virtualoffice.key" \
  --certificate="$CERT_DIR/virtualoffice.crt" \
  --path="$PWD/build/release/virtualoffice"
COPYFILE_DISABLE=1 tar --no-xattrs -czf build/artifacts/virtualoffice-<version>-signed.tar.gz -C build/release virtualoffice
```

Confirm that the signed tarball contains `virtualoffice/appinfo/signature.json`. Install **that exact tarball** on a clean Nextcloud 35 instance, enable the app, and run `occ integrity:check-app virtualoffice`. Any content change after signing requires signing again.

## Publish

Tag the reviewed source version and attach the signed custom tarball to the GitHub release. Host it at a public HTTPS URL. Do not use GitHub's automatic source archive.

Register `virtualoffice` on the [Nextcloud App Store](https://apps.nextcloud.com/developer/apps/new) with the public certificate and a signature over the app ID. Then [upload the release](https://apps.nextcloud.com/developer/apps/releases/new) with its HTTPS URL and a separate SHA-512 signature over the **exact signed tarball**:

```sh
printf %s virtualoffice | openssl dgst -sha512 -sign "$CERT_DIR/virtualoffice.key" | openssl base64 -A
openssl dgst -sha512 -sign "$CERT_DIR/virtualoffice.key" build/artifacts/virtualoffice-<version>-signed.tar.gz | openssl base64 -A
```

Keep the private key and both signatures out of Git. The Store asks for the app-ID signature during registration and the archive signature during release upload. See the [App Store developer guide](https://nextcloudappstore.readthedocs.io/en/stable/developer.html).

## Public pages and launch

The source repository must be public before requesting the app certificate. After the owner reviews the clean initial commit, make the repository public and check that the README, documentation, and screenshot URLs work without signing in.

In GitHub, set the repository description from [launch-copy.md](launch-copy.md), set the homepage to `https://hweihwang.github.io/virtualoffice/`, enable private vulnerability reporting for [SECURITY.md](../SECURITY.md), and upload [social-preview.png](media/social-preview.png) in **Settings › Social preview**. Publish GitHub Pages from the `main` branch's `/docs` folder. Check the landing page on desktop and mobile, including video playback and the App Store link.

The [24-second demo](media/demo.mp4) is ready for the landing page. To show it in the App Store gallery, upload it to PeerTube and add its public HTTPS URL as a `<video>` element in `appinfo/info.xml` **before** packaging and signing. The App Store does not accept YouTube links in that field. If no PeerTube account is available, the two screenshots remain the gallery; the landing page still shows the demo.

After the App Store release is live, check the installation link in the README and landing page, then use the ready [launch copy](launch-copy.md) for the announcement.
