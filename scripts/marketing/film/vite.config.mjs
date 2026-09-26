/**
 * SPDX-FileCopyrightText: 2026 Hoang Pham
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
import { resolve } from 'node:path'
import { defineConfig } from 'vite'

const root = resolve(import.meta.dirname, '../../..')

export default defineConfig({
	root: import.meta.dirname,
	base: './',
	logLevel: 'warn',
	build: {
		outDir: resolve(root, 'build/film/page'),
		emptyOutDir: true,
		assetsInlineLimit: 0,
		minify: false,
		chunkSizeWarningLimit: 4000,
	},
	server: { fs: { allow: [root] } },
})
