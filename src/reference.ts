/**
 * SPDX-FileCopyrightText: 2026 Hoang Pham
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
import type { OfficeCard } from './api.ts'

import { getRequestToken } from '@nextcloud/auth'
import { n, t } from '@nextcloud/l10n'
import { generateOcsUrl, generateUrl, imagePath } from '@nextcloud/router'

type RenderCallback = (el: HTMLElement, options: { richObject: Record<string, unknown>, interactive: boolean }) => void

interface TalkMessageActionData {
	metadata: { token: string, type: number }
}

declare global {
	interface Window {
		_vue_richtext_widgets?: Record<string, unknown>
		OCA: Record<string, unknown> & { Talk?: { registerMessageAction?: (action: { label: string, icon: string, callback: (data: TalkMessageActionData) => void }) => void } }
	}
}

/**
 * Same registry entry as registerWidget() from `@nextcloud/vue` writes. Doing it
 * directly keeps this script tiny: it loads in every Talk or Text view that
 * shows references, and the library entry would pull in the whole picker.
 * The interactive office is only loaded after the viewer turns it on.
 */
function registerWidget(id: string, callback: RenderCallback, onDestroy: (el: HTMLElement) => void): void {
	window._vue_richtext_widgets ??= {}
	window._vue_richtext_widgets[id] ??= { id, callback, onDestroy, hasInteractiveView: true, fullWidth: true, isResizable: false }
}

const controllers = new WeakMap<HTMLElement, AbortController>()
const embeds = new WeakMap<HTMLElement, { destroy: () => void }>()

async function fetchCard(token: string, signal: AbortSignal): Promise<OfficeCard> {
	const response = await fetch(generateOcsUrl('/apps/virtualoffice/api/v1/offices/{token}/card', { token }), {
		signal,
		credentials: 'same-origin',
		headers: { Accept: 'application/json', 'OCS-APIRequest': 'true', requesttoken: getRequestToken() ?? '' },
	})
	if (!response.ok) {
		throw Object.assign(new Error('Card unavailable'), { status: response.status })
	}
	return (await response.json()).ocs.data
}

function peopleText(card: OfficeCard): string {
	const time = new Date(card.observedAt * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
	if (card.count === 0) {
		return t('virtualoffice', 'Nobody there at {time}', { time })
	}
	const names = card.people.map((p) => p.name)
	return card.count > names.length
		? n('virtualoffice', '{names} and %n more are there', '{names} and %n more are there', card.count - names.length, { names: names.join(', ') })
		: t('virtualoffice', '{names} there at {time}', { names: names.join(', '), time })
}

function render(el: HTMLElement, token: string, url: string, interactive: boolean): void {
	const controller = new AbortController()
	controllers.get(el)?.abort()
	controllers.set(el, controller)
	embeds.get(el)?.destroy()
	embeds.delete(el)

	const card = document.createElement('div')
	card.className = 'vo-card'
	const art = document.createElement('img')
	art.className = 'vo-card__art'
	art.src = imagePath('virtualoffice', 'office-preview.webp')
	art.alt = ''
	const body = document.createElement('div')
	body.className = 'vo-card__body'
	const title = document.createElement('strong')
	title.textContent = t('virtualoffice', 'Virtual office')
	const meta = document.createElement('span')
	meta.className = 'vo-card__meta'
	meta.textContent = t('virtualoffice', 'Loading…')
	const call = document.createElement('span')
	call.className = 'vo-card__call'
	const link = document.createElement('a')
	link.className = 'vo-card__open'
	link.href = url
	link.textContent = t('virtualoffice', 'Open office')
	body.append(title, meta, call, link)
	card.append(art, body)
	el.replaceChildren(card)

	fetchCard(token, controller.signal)
		.then(async (info) => {
			title.textContent = info.title
			meta.textContent = `${info.audience} · ${peopleText(info)}`
			if (info.call?.known && info.call.active) {
				call.textContent = n('virtualoffice', 'Call in progress with %n person', 'Call in progress with %n people', info.call.participants.length)
			}
			if (interactive && info.canEnter) {
				const host = document.createElement('div')
				host.className = 'vo-card__embed'
				el.append(host)
				const { mountEmbeddedOffice } = await import('./embed.ts')
				if (!controller.signal.aborted) {
					embeds.set(el, mountEmbeddedOffice(host, token, info))
				}
			}
		})
		.catch((error) => {
			if (!controller.signal.aborted) {
				meta.textContent = error?.status === 404
					? t('virtualoffice', 'This office is not available to you')
					: t('virtualoffice', 'Details could not be loaded')
			}
		})
}

registerWidget('virtualoffice_office', (el, { richObject, interactive }) => {
	const token = String(richObject.token ?? '')
	const url = String(richObject.url ?? '')
	if (/^[a-f0-9]{32}$/.test(token)) {
		render(el, token, url, interactive)
	}
}, (el) => {
	controllers.get(el)?.abort()
	controllers.delete(el)
	embeds.get(el)?.destroy()
	embeds.delete(el)
	el.replaceChildren()
})

/**
 * In Talk, every message menu offers the conversation's office, using Talk's
 * frontend integration API (the one Deck uses for "Create a card").
 */
function registerTalkAction(attempt = 0): void {
	const register = window.OCA?.Talk?.registerMessageAction
	if (!register) {
		if (attempt < 40) {
			setTimeout(() => registerTalkAction(attempt + 1), 250)
		}
		return
	}
	register({
		label: t('virtualoffice', 'Open conversation office'),
		icon: 'icon-virtualoffice',
		callback: ({ metadata }) => {
			window.open(generateUrl('/apps/virtualoffice/talk/{token}', { token: metadata.token }), '_blank', 'noopener')
		},
	})
}
if (/\/(apps\/spreed|call\/)/.test(window.location.pathname)) {
	registerTalkAction()
}

const style = document.createElement('style')
style.textContent = `
.vo-card { display: flex; gap: 12px; align-items: center; padding: 10px; border-radius: var(--border-radius-large, 10px); }
.vo-card__art { width: 96px; height: 54px; border-radius: 8px; object-fit: cover; flex: none; }
.vo-card__body { display: flex; flex-direction: column; min-width: 0; gap: 2px; }
.vo-card__body strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.vo-card__meta { color: var(--color-text-maxcontrast); }
.vo-card__call:not(:empty) { color: var(--color-success-text); font-weight: 600; }
.vo-card__open { color: var(--color-primary-element); font-weight: 600; }
.vo-card__embed { padding: 0 10px 10px; }
.icon-virtualoffice { background-image: url(${imagePath('virtualoffice', 'app-dark.svg')}); background-size: 16px; }
[data-theme-dark] .icon-virtualoffice, [data-theme-dark-highcontrast] .icon-virtualoffice { background-image: url(${imagePath('virtualoffice', 'app.svg')}); }
`
document.head.append(style)
