<!--
  - SPDX-FileCopyrightText: 2026 Hoang Pham
  - SPDX-License-Identifier: AGPL-3.0-or-later
-->
# Releasing Virtual Office

The release archive is a custom tarball with one top-level `virtualoffice/` directory. GitHub's automatically generated source archives do not have that layout. The app supports Nextcloud 35; do not widen the version range without testing the new version.

## Prepare

1. Choose the release version in `package.json` and `appinfo/info.xml`. Add a matching `## <version>` entry to `CHANGELOG.md`.
2. Review the app metadata, links, screenshots, license notices, and changes since the previous release. When the interface changed, rebuild the screenshots, the social preview and the demo video with `scripts/marketing/build.sh`; it resets the test fixture and needs ffmpeg, cwebp and ImageMagick. Check every image and the video before committing them.
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

Signing needs a Nextcloud app certificate for the `virtualoffice` app ID. This is a one-time step. The owner keeps the 4096-bit RSA key, the CSR (`CN=virtualoffice`) and the certificate in `~/.nextcloud/certificates/`, outside this repository and readable only by the owner. The CSR was submitted to [app-certificate-requests](https://github.com/nextcloud/app-certificate-requests/pull/1271); Nextcloud answers with the public `virtualoffice.crt`, which goes next to the key. See the [code-signing guide](https://docs.nextcloud.com/server/stable/developer_manual/app_publishing_maintenance/code_signing.html).

## Sign the exact release contents

After the final build and tests, run:

```sh
scripts/sign-release.sh ~/.nextcloud/certificates
```

The script checks that the certificate belongs to the key, builds and packages the app, signs it with `occ integrity:sign-app` inside the test fixture (removing the key from the container right after), and writes `build/artifacts/virtualoffice-<version>-signed.tar.gz`. It prints the archive's SHA-256, the app-ID signature and the archive signature. Keep the key and both signatures out of Git.

Then install **that exact tarball** on clean Nextcloud 35 instances:

```sh
tests/fixture/matrix.sh build/artifacts/virtualoffice-<version>-signed.tar.gz
```

For a signed archive, the matrix also runs `occ integrity:check-app virtualoffice` and fails unless the signature verifies against Nextcloud's root certificate. Any content change after signing requires signing again.

## Publish

1. Create the GitHub release `v<version>` from the reviewed commit, with the `CHANGELOG.md` entry as notes, and attach the signed tarball. Its download URL is the public HTTPS URL for the App Store. Do not use GitHub's automatic source archive.

   ```sh
   awk '/^## /{p=($2=="<version>")} p' CHANGELOG.md | tail -n +3 > build/notes.md
   gh release create v<version> build/artifacts/virtualoffice-<version>-signed.tar.gz --target main --title <version> --notes-file build/notes.md
   ```

   The download URL is `https://github.com/hweihwang/virtualoffice/releases/download/v<version>/virtualoffice-<version>-signed.tar.gz`.
2. For the first release only, [register the app](https://apps.nextcloud.com/developer/apps/new) with the contents of `virtualoffice.crt` and the app-ID signature.
3. [Upload the release](https://apps.nextcloud.com/developer/apps/releases/new) with the tarball's download URL and the archive signature.

See the [App Store developer guide](https://nextcloudappstore.readthedocs.io/en/stable/developer.html).

## Public pages and launch

The repository is public, with the description, homepage and topics from [launch-copy.md](launch-copy.md), private vulnerability reporting for [SECURITY.md](../SECURITY.md), and GitHub Pages from the `main` branch's `/docs` folder. The [social preview](media/social-preview.png) is uploaded in **Settings › General › Social preview**; upload it again if the image changes. After changing the landing page, check it on desktop and mobile, including video playback.

The [36-second demo](media/demo.mp4) is ready for the landing page. To show it in the App Store gallery, upload it to PeerTube and add its public HTTPS URL as a `<video>` element in `appinfo/info.xml` **before** packaging and signing. The App Store does not accept YouTube links in that field. If no PeerTube account is available, the three screenshots remain the gallery; the landing page still shows the demo.

After the App Store release is live, replace the pending-listing text in the README and landing page with links to the live listing, check those links, then use the ready [launch copy](launch-copy.md) for the announcement.
