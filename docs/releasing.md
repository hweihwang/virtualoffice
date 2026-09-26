<!--
  - SPDX-FileCopyrightText: 2026 Hoang Pham
  - SPDX-License-Identifier: AGPL-3.0-or-later
-->
# Releasing Virtual Office

The release archive is a custom tarball with one top-level `virtualoffice/` directory. GitHub's automatically generated source archives do not have that layout. The app supports Nextcloud 35; do not widen the version range without testing the new version.

## Prepare

1. Choose the release version in `package.json` and `appinfo/info.xml`. Add a matching `## <version>` entry to `CHANGELOG.md`.
2. Review the app metadata, links, screenshots, license notices, and changes since the previous release. When the interface changed, rebuild the screenshots, the social preview and the product page assets with `scripts/marketing/build.sh`; it resets the test fixture and needs ffmpeg, cwebp and ImageMagick. When the office artwork changed, render the film again with `node scripts/marketing/film/render.mjs`. Check every image and the film before committing them.
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

The script checks that the certificate belongs to the key, builds and packages the app, signs it with `occ integrity:sign-app` inside the test fixture, and verifies the signed app against Nextcloud's root certificate before writing `build/artifacts/virtualoffice-<version>-signed.tar.gz`. It removes the key and temporary files from the container even if signing fails. It prints the archive's SHA-256, the app-ID signature and the archive signature. Keep the key and both signatures out of Git.

Then install **that exact tarball** on clean Nextcloud 35 instances:

```sh
tests/fixture/matrix.sh build/artifacts/virtualoffice-<version>-signed.tar.gz
```

For a signed archive, the matrix also runs `occ integrity:check-app virtualoffice` and fails unless the signature verifies against Nextcloud's root certificate. Any content change after signing requires signing again.

## Publish

1. Publish the GitHub release `v<version>` from the reviewed, pushed commit, with the `CHANGELOG.md` entry as notes, and attach the signed tarball. Its download URL is the public HTTPS URL for the App Store. Do not use GitHub's automatic source archive. For `v1.0.0`, the release already exists as a draft with notes, so update that draft instead of creating another release:

   ```sh
   gh release edit v1.0.0 --target "$(git rev-parse HEAD)"
   gh release upload v1.0.0 build/artifacts/virtualoffice-1.0.0-signed.tar.gz
   gh release edit v1.0.0 --draft=false
   ```

   The download URL is `https://github.com/hweihwang/virtualoffice/releases/download/v<version>/virtualoffice-<version>-signed.tar.gz`. For later versions, create a new draft from the reviewed commit before uploading.
2. For the first release only, [register the app](https://apps.nextcloud.com/developer/apps/new) with the contents of `virtualoffice.crt` and the app-ID signature.
3. [Upload the release](https://apps.nextcloud.com/developer/apps/releases/new) with the tarball's download URL and the archive signature.

See the [App Store developer guide](https://nextcloudappstore.readthedocs.io/en/stable/developer.html).

## Public pages and launch

The repository is public, with the description, homepage and topics from [launch-copy.md](launch-copy.md), private vulnerability reporting for [SECURITY.md](../SECURITY.md), and GitHub Pages from the `main` branch's `/docs` folder, which now only forwards to the product page. The [social preview](media/social-preview.png) is uploaded in **Settings › General › Social preview**; upload it again if the image changes.

The product page is https://hweihwang.com/virtualoffice/, in the hweihwang.com repository. To update it, copy `build/marketing/site/*` (written by `scripts/marketing/render.mjs`, including the film from `build/film/`) into its `virtualoffice/` folder, then deploy that repository. Check the page on desktop and mobile, including film playback.

The film plays on the product page. To show it in the App Store gallery, upload it to PeerTube and add its public HTTPS URL as a `<video>` element in `appinfo/info.xml` **before** packaging and signing. The App Store does not accept YouTube links in that field. If no PeerTube account is available, the five screenshots remain the gallery.

After the App Store release is live, replace the pending-listing text in the README, `docs/admin.md` and the product page with links to the live listing, check those links, then use the ready [launch copy](launch-copy.md) for the announcement.
