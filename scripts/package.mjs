/**
 * SPDX-FileCopyrightText: 2026 Hoang Pham
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Builds build/artifacts/virtualoffice-<version>.tar.gz with only what a
 * Nextcloud server needs. Run `npm run build` first.
 */
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version
const infoVersion = readFileSync(join(root, 'appinfo/info.xml'), 'utf8').match(/<version>([^<]+)<\/version>/)[1]
if (version !== infoVersion) {
	throw new Error(`package.json (${version}) and appinfo/info.xml (${infoVersion}) versions differ`)
}
if (!existsSync(join(root, 'js/virtualoffice-main.mjs'))) {
	throw new Error('Run npm run build first')
}

const staging = join(root, 'build/staging/virtualoffice')
rmSync(join(root, 'build/staging'), { recursive: true, force: true })
mkdirSync(staging, { recursive: true })
for (const path of ['appinfo', 'catalog', 'img', 'lib', 'templates', 'LICENSES', 'README.md', 'CHANGELOG.md', 'REUSE.toml']) {
	cpSync(join(root, path), join(staging, path), { recursive: true })
}
mkdirSync(join(staging, 'js'))
for (const file of readdirSync(join(root, 'js'))) {
	if (!file.endsWith('.map')) {
		cpSync(join(root, 'js', file), join(staging, 'js', file))
	}
}

mkdirSync(join(root, 'build/artifacts'), { recursive: true })
const archive = join(root, `build/artifacts/virtualoffice-${version}.tar.gz`)
execFileSync('tar', ['--no-xattrs', '-czf', archive, '-C', join(root, 'build/staging'), 'virtualoffice'], { env: { ...process.env, COPYFILE_DISABLE: '1' } })
rmSync(join(root, 'build/staging'), { recursive: true, force: true })
console.log(archive)
