/**
 * SPDX-FileCopyrightText: 2026 Hoang Pham
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
import { createAppConfig } from '@nextcloud/vite-config'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const catalogHash = createHash('sha256').update(readFileSync(resolve('catalog/catalog.json'))).digest('hex')

export default createAppConfig({
	main: resolve(join('src', 'main.ts')),
	reference: resolve(join('src', 'reference.ts')),
	admin: resolve(join('src', 'admin.ts')),
}, {
	inlineCSS: { relativeCSSInjection: true },
	config: {
		define: {
			__CATALOG_HASH__: JSON.stringify(catalogHash),
		},
		build: {
			chunkSizeWarningLimit: 1500,
		},
	},
})
