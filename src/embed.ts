/**
 * SPDX-FileCopyrightText: 2026 Hoang Pham
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
import type { OfficeCard } from './api.ts'

import { createApp } from 'vue'
import EmbeddedOffice from './views/EmbeddedOffice.vue'

/** Mounts the live office inside a reference widget, e.g. a Talk message. */
export function mountEmbeddedOffice(host: HTMLElement, token: string, card: OfficeCard): { destroy: () => void } {
	let exposed: { dispose?: () => void } | null = null
	const app = createApp(EmbeddedOffice, {
		token,
		card,
		onReady: (handle: { dispose: () => void }) => {
			exposed = handle
		},
	})
	app.mount(host)
	return {
		destroy: () => {
			exposed?.dispose?.()
			app.unmount()
		},
	}
}
