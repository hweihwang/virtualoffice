/**
 * SPDX-FileCopyrightText: 2026 Hoang Pham
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
import type { Cell } from '../../shared/catalog.ts'
import type { Direction } from '../../shared/movement.ts'
import type { PersonView, RoomSession } from '../session/room.ts'

import { mdiBalloon, mdiEmoticonExcited, mdiEmoticonLol, mdiGlassMugVariant, mdiHandClap, mdiHandWave, mdiHeadset, mdiHeart, mdiHeartMultiple, mdiMicrophone, mdiPartyPopper, mdiSleep, mdiTimerSand } from '@mdi/js'
import { isWalkable } from '../../shared/catalog.ts'
import { mapSvg } from './map.ts'
import { creatureSvg } from './sprites.ts'

const TILE = 40
export const EMOTE_ICONS: Record<string, string> = {
	wave: mdiHandWave,
	heart: mdiHeart,
	laugh: mdiEmoticonLol,
	celebrate: mdiPartyPopper,
}
/** Shown between two people who reacted together. */
const PAIR_ICONS: Record<string, string> = {
	wave: mdiHandClap,
	heart: mdiHeartMultiple,
	laugh: mdiEmoticonExcited,
	celebrate: mdiPartyPopper,
}
const KEYS: Record<string, Direction> = {
	ArrowUp: 'north',
	ArrowRight: 'east',
	ArrowDown: 'south',
	ArrowLeft: 'west',
	w: 'north',
	d: 'east',
	s: 'south',
	a: 'west',
	W: 'north',
	D: 'east',
	S: 'south',
	A: 'west',
}

interface ActorElements {
	root: HTMLElement
	sprite: HTMLElement
	name: HTMLElement
	mode: HTMLElement
	emote: HTMLElement
	status: HTMLElement
	signature: string
	/** Stage position from the last frame. */
	at: [number, number]
}

export interface RendererOptions {
	zoneLabels: Record<string, string>
	youName: (name: string) => string
	/** Label of an office status, e.g. "Do not disturb". */
	statusLabel: (status: string) => string
	reducedMotion: () => boolean
	/** "22:40", with a note when that is outside the person's working hours; empty when unknown. */
	clockLabel?: (uid: string) => string
	/** Whose voice is heard right now. */
	speaking?: (uid: string) => boolean
	/** Title of the microphone on the name tags of people with voice on. */
	voiceLabel?: string
	onPropBlocked?: () => void
}

/**
 * Draws the room into plain DOM nodes and moves them with transforms on
 * every animation frame. Vue only handles the surrounding UI.
 */
export class SceneRenderer {
	private viewport: HTMLElement
	private stage: HTMLElement
	private background: HTMLElement
	private actorsLayer: HTMLElement
	private actors = new Map<string, ActorElements>()
	private propFx = new Map<string, HTMLElement>()
	private playerFx: HTMLElement | null = null
	private pairsLayer: HTMLElement
	private pairFx = new Map<string, HTMLElement>()
	private desksLayer: HTMLElement
	private deskPlates = new Map<string, HTMLElement>()
	private desksKey = ''
	private desksTimes: unknown = null
	private fixturesLayer: HTMLElement
	private fixturesKey = ''
	private frameId: number | null = null
	private lastFrame = 0
	private scale = 1
	private decorKey = ''
	private resizeObserver: ResizeObserver
	private userScrolledAt = 0
	private cleanup: (() => void)[] = []

	constructor(private root: HTMLElement, private session: RoomSession, private options: RendererOptions) {
		const layout = session.layoutData
		root.classList.add('vo-scene')
		this.viewport = el('div', 'vo-viewport')
		this.stage = el('div', 'vo-stage')
		this.stage.style.width = `${layout.width * TILE}px`
		this.stage.style.height = `${layout.height * TILE}px`
		this.background = el('div', 'vo-background')
		this.actorsLayer = el('div', 'vo-actors')
		this.pairsLayer = el('div', 'vo-pairs')
		this.desksLayer = el('div', 'vo-desks')
		this.fixturesLayer = el('div', 'vo-fixtures')
		this.stage.append(this.background, this.zoneLabels(), this.propLayer(), this.fixturesLayer, this.desksLayer, this.actorsLayer, this.pairsLayer)
		this.viewport.append(this.stage)
		root.append(this.viewport)

		this.on(this.stage, 'click', (event) => this.onClick(event as MouseEvent))
		this.on(root, 'keydown', (event) => this.onKey(event as KeyboardEvent, true))
		this.on(root, 'keyup', (event) => this.onKey(event as KeyboardEvent, false))
		this.on(root, 'blur', () => this.session.stopWalking())
		const scrolled = () => {
			this.userScrolledAt = performance.now()
		}
		this.on(root, 'wheel', scrolled, { passive: true })
		this.on(root, 'touchmove', scrolled, { passive: true })
		this.resizeObserver = new ResizeObserver(() => this.fit())
		this.resizeObserver.observe(root)
		this.fit()
		this.setDecor(session.state.decor)
	}

	setDecor(decor: Record<string, string>): void {
		const key = JSON.stringify(decor)
		if (key !== this.decorKey) {
			this.decorKey = key
			this.background.innerHTML = mapSvg(this.session.layoutKey, decor)
		}
	}

	start(): void {
		if (this.frameId === null) {
			this.lastFrame = performance.now()
			this.frameId = requestAnimationFrame((t) => this.frame(t))
		}
	}

	stop(): void {
		if (this.frameId !== null) {
			cancelAnimationFrame(this.frameId)
			this.frameId = null
		}
	}

	destroy(): void {
		this.stop()
		this.resizeObserver.disconnect()
		this.cleanup.forEach((fn) => fn())
		this.viewport.remove()
		this.root.classList.remove('vo-scene')
	}

	/**
	 * Draws one frame; exposed for tests and for hidden tabs returning.
	 */
	frame(now: number): void {
		const dt = now - this.lastFrame
		this.lastFrame = now
		const serverNow = this.session.clock.serverNow()
		const reduced = this.options.reducedMotion()
		this.root.classList.toggle('vo-reduced', reduced)
		this.syncActors()
		this.syncDesks()
		this.syncFixtures()
		for (const [uid, actor] of this.actors) {
			const motion = this.session.motions.get(uid)
			if (!motion) {
				continue
			}
			const { position: [x, y], facing, moving } = motion.sample(serverNow, dt)
			actor.at = [x * TILE + TILE / 2 - 24, y * TILE + TILE - 58]
			actor.root.style.transform = `translate3d(${actor.at[0]}px, ${actor.at[1]}px, 0)`
			actor.root.style.zIndex = String(10 + Math.round(y * 10))
			actor.root.classList.toggle('vo-walking', moving)
			actor.sprite.dataset.facing = facing
			actor.root.classList.toggle('vo-in-call', Boolean(this.session.state.call?.active && this.session.state.call.participants.includes(uid)))
			actor.root.classList.toggle('vo-speaking', this.options.speaking?.(uid) ?? false)
			const person = this.session.state.people.find((p) => p.uid === uid)
			actor.emote.classList.toggle('vo-visible', Boolean(person && this.session.emoteShowing(person, serverNow)))
		}
		for (const [id, fx] of this.propFx) {
			fx.classList.toggle('vo-active', this.session.propShowing(id, serverNow))
		}
		this.propFx.get('coffee')?.classList.toggle('vo-clink', this.session.clinking(serverNow).length > 0)
		this.playerFx?.classList.toggle('vo-active', this.session.state.music !== null)
		this.drawPairs(serverNow)
		this.follow()
		this.frameId = requestAnimationFrame((t) => this.frame(t))
	}

	/**
	 * Cell under a pointer position, or null outside the map.
	 */
	cellAt(clientX: number, clientY: number): Cell | null {
		const box = this.stage.getBoundingClientRect()
		const x = Math.floor((clientX - box.left) / this.scale / TILE)
		const y = Math.floor((clientY - box.top) / this.scale / TILE)
		const layout = this.session.layoutData
		return x >= 0 && y >= 0 && x < layout.width && y < layout.height ? [x, y] : null
	}

	private onClick(event: MouseEvent): void {
		if ((event.target as HTMLElement).closest('.vo-fixture')) {
			return
		}
		this.root.focus({ preventScroll: true })
		const actorEl = (event.target as HTMLElement).closest<HTMLElement>('.vo-actor')
		if (actorEl && actorEl.dataset.uid && !actorEl.classList.contains('vo-you')) {
			this.walkNextTo(actorEl.dataset.uid)
			return
		}
		const cell = this.cellAt(event.clientX, event.clientY)
		if (cell === null) {
			return
		}
		const prop = this.session.layoutData.props.find((p) => p.cell[0] === cell[0] && p.cell[1] === cell[1])
		if (prop) {
			this.session.useProp(prop.id)
			return
		}
		const player = this.session.layoutData.player
		if (player && player.cell[0] === cell[0] && player.cell[1] === cell[1]) {
			this.session.goToPlayer()
			return
		}
		if (!isWalkable(this.session.layoutData, cell) || !this.session.walkTo(cell)) {
			this.options.onPropBlocked?.()
		}
	}

	walkNextTo(uid: string): void {
		const motion = this.session.motions.get(uid)
		if (!motion) {
			return
		}
		const [x, y] = motion.trajectory.points[motion.trajectory.points.length - 1]
		const target: Cell = [Math.round(x), Math.round(y)]
		const layout = this.session.layoutData
		for (const [dx, dy] of [[0, 1], [1, 0], [-1, 0], [0, -1], [1, 1], [-1, 1]]) {
			const cell: Cell = [target[0] + dx, target[1] + dy]
			if (isWalkable(layout, cell) && this.session.walkTo(cell)) {
				return
			}
		}
		this.session.walkTo(target)
	}

	private onKey(event: KeyboardEvent, down: boolean): void {
		if (event.metaKey || event.ctrlKey || event.altKey) {
			return
		}
		const direction = KEYS[event.key]
		if (direction) {
			event.preventDefault()
			if (down) {
				if (!event.repeat) {
					this.session.startWalking(direction)
				}
			} else {
				this.session.stopWalking(direction)
			}
			return
		}
		if (!down) {
			return
		}
		if (event.key === 'Escape') {
			this.root.blur()
		} else if (event.key === 'Enter' || event.key === ' ') {
			const position = this.session.ownPosition()
			const prop = position && this.session.layoutData.props.find((p) => Math.hypot(position[0] - p.cell[0], position[1] - p.cell[1]) <= p.radius)
			if (prop) {
				event.preventDefault()
				this.session.useProp(prop.id)
			}
		} else if (['1', '2', '3', '4'].includes(event.key)) {
			const emote = Object.keys(EMOTE_ICONS)[Number(event.key) - 1]
			void this.session.emote(emote)
		}
	}

	private syncActors(): void {
		const people = this.session.state.people
		const seen = new Set<string>()
		for (const person of people) {
			seen.add(person.uid)
			let actor = this.actors.get(person.uid)
			if (!actor) {
				actor = this.createActor(person)
				this.actors.set(person.uid, actor)
				this.actorsLayer.append(actor.root)
			}
			this.updateActor(actor, person)
		}
		for (const [uid, actor] of this.actors) {
			if (!seen.has(uid)) {
				actor.root.remove()
				this.actors.delete(uid)
			}
		}
	}

	private createActor(person: PersonView): ActorElements {
		const root = el('div', 'vo-actor')
		root.dataset.uid = person.uid
		root.classList.toggle('vo-you', person.isYou)
		const shadow = el('div', 'vo-shadow')
		const sprite = el('div', 'vo-sprite')
		const emote = el('div', 'vo-emote')
		const plate = el('div', 'vo-nameplate')
		const mode = el('span', 'vo-mode')
		const status = el('span', 'vo-status')
		const sleep = el('div', 'vo-sleep')
		sleep.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${mdiSleep}"/></svg>`
		const balloon = el('div', 'vo-balloon')
		balloon.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${mdiBalloon}"/></svg>`
		const focusing = el('span', 'vo-focus-badge')
		focusing.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${mdiTimerSand}"/></svg>`
		const call = el('span', 'vo-call-badge')
		call.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${mdiHeadset}"/></svg>`
		const voice = el('span', 'vo-voice-badge')
		voice.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${mdiMicrophone}"/></svg>`
		voice.title = this.options.voiceLabel ?? ''
		const name = el('span', 'vo-name')
		plate.append(mode, name, status, focusing, call, voice)
		root.append(shadow, balloon, sprite, sleep, emote, plate)
		return { root, sprite, name, mode, emote, status, signature: '', at: [0, 0] }
	}

	private updateActor(actor: ActorElements, person: PersonView): void {
		const appearance = `${person.appearance.creature}/${person.appearance.palette}/${person.appearance.accessory}`
		const signature = `${appearance}|${person.name}|${person.mode}|${person.emote?.id ?? ''}${person.emote?.startedAt ?? ''}|${person.status?.status ?? ''}|${person.note ?? ''}|${person.birthday}|${person.focusing}|${person.voice !== null}`
		if (signature === actor.signature) {
			return
		}
		if (!actor.signature.startsWith(appearance + '|')) {
			actor.sprite.innerHTML = (['south', 'north', 'east'] as const)
				.map((facing) => `<div class="vo-facing vo-facing-${facing}">${creatureSvg(person.appearance, facing)}</div>`).join('')
		}
		actor.signature = signature
		actor.name.textContent = person.isYou ? this.options.youName(person.name) : person.name
		actor.mode.dataset.mode = person.mode
		actor.root.dataset.mode = person.mode
		actor.root.classList.toggle('vo-sleeping', person.status?.status === 'away')
		actor.root.classList.toggle('vo-birthday', person.birthday)
		actor.root.classList.toggle('vo-focusing', person.focusing)
		actor.root.classList.toggle('vo-voice', person.voice !== null)
		actor.status.dataset.status = person.status?.status ?? ''
		actor.status.title = person.status ? this.options.statusLabel(person.status.status) : ''
		actor.root.title = person.note ?? ''
		if (person.emote) {
			const path = EMOTE_ICONS[person.emote.id] ?? ''
			actor.emote.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${path}"/></svg>`
			actor.emote.dataset.emote = person.emote.id
		}
	}

	/**
	 * Owned desks show the owner's name, and while they are not inside their
	 * status and "Today" note, so a quiet office still shows who belongs there.
	 */
	private syncDesks(): void {
		const { desks, statuses, people } = this.session.state
		const inside = new Set(people.map((p) => p.uid))
		// The minute is part of the key, so local times in the tooltips stay current.
		const key = JSON.stringify([desks, statuses, [...inside], Math.floor(Date.now() / 60_000)])
		if (key === this.desksKey && this.session.state.times === this.desksTimes) {
			return
		}
		this.desksKey = key
		this.desksTimes = this.session.state.times
		const seen = new Set<string>()
		for (const owner of desks) {
			const seat = this.session.layoutData.desks?.find((d) => d.id === owner.deskId)
			if (!seat) {
				continue
			}
			seen.add(owner.deskId)
			let plate = this.deskPlates.get(owner.deskId)
			if (!plate) {
				plate = el('div', 'vo-desk')
				plate.style.left = `${seat.cell[0] * TILE + TILE / 2}px`
				plate.style.top = `${(seat.cell[1] - 1) * TILE}px`
				this.deskPlates.set(owner.deskId, plate)
				this.desksLayer.append(plate)
			}
			const status = statuses[owner.uid]
			const away = !inside.has(owner.uid)
			plate.dataset.uid = owner.uid
			plate.dataset.deskId = owner.deskId
			plate.classList.toggle('vo-desk-away', away)
			plate.replaceChildren()
			const name = el('span', 'vo-desk-name')
			const dot = el('span', 'vo-status')
			dot.dataset.status = status?.status ?? ''
			name.append(dot, document.createTextNode(owner.birthday ? `🎈 ${owner.name}` : owner.name))
			plate.append(name)
			const line = away ? (owner.note ?? status?.message ?? '') : ''
			if (line) {
				const note = el('span', 'vo-desk-note')
				note.textContent = line
				plate.append(note)
			}
			plate.title = [owner.name, this.options.clockLabel?.(owner.uid) ?? '', status ? this.options.statusLabel(status.status) : '', status?.message ?? '', owner.note ?? ''].filter(Boolean).join(' · ')
		}
		for (const [deskId, plate] of this.deskPlates) {
			if (!seen.has(deskId)) {
				plate.remove()
				this.deskPlates.delete(deskId)
			}
		}
	}

	/** The Team's shared resources hang on the wall and open in a new tab. */
	private syncFixtures(): void {
		const resources = this.session.state.resources
		const key = JSON.stringify(resources)
		if (key === this.fixturesKey) {
			return
		}
		this.fixturesKey = key
		this.fixturesLayer.replaceChildren()
		const slots = this.session.layoutData.fixtures ?? []
		resources.slice(0, slots.length).forEach((resource, i) => {
			const link = document.createElement('a')
			link.className = 'vo-fixture'
			link.href = resource.url
			link.target = '_blank'
			link.rel = 'noopener'
			link.title = resource.label
			link.dataset.provider = resource.provider
			link.style.left = `${slots[i].cell[0] * TILE + TILE / 2}px`
			link.style.top = `${slots[i].cell[1] * TILE + 4}px`
			const icon = el('span', 'vo-fixture-icon')
			if (resource.iconEmoji) {
				icon.textContent = resource.iconEmoji
			} else {
				const img = document.createElement('img')
				img.alt = ''
				// SVG as an image, so its markup never runs in the page.
				img.src = resource.iconSvg ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(resource.iconSvg)}` : (resource.iconUrl ?? '')
				icon.append(img)
			}
			const label = el('span', 'vo-fixture-label')
			label.textContent = resource.label
			link.append(icon, label)
			if (resource.badge) {
				const badge = el('span', 'vo-fixture-badge')
				badge.textContent = resource.badge
				link.append(badge)
			}
			this.fixturesLayer.append(link)
		})
	}

	/** A joint effect between each two people reacting together. */
	private drawPairs(serverNow: number): void {
		const seen = new Set<string>()
		for (const pair of this.session.pairs(serverNow)) {
			const key = `${pair.uids.join(':')}:${pair.startedAt}`
			const [a, b] = pair.uids.map((uid) => this.actors.get(uid))
			if (!a || !b) {
				continue
			}
			seen.add(key)
			let fx = this.pairFx.get(key)
			if (!fx) {
				fx = el('div', 'vo-pair')
				fx.dataset.emote = pair.emote
				fx.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${PAIR_ICONS[pair.emote] ?? mdiHeart}"/></svg>`
				this.pairFx.set(key, fx)
				this.pairsLayer.append(fx)
			}
			fx.style.transform = `translate3d(${(a.at[0] + b.at[0]) / 2}px, ${Math.min(a.at[1], b.at[1])}px, 0)`
		}
		for (const [key, fx] of this.pairFx) {
			if (!seen.has(key)) {
				fx.remove()
				this.pairFx.delete(key)
			}
		}
	}

	private zoneLabels(): HTMLElement {
		const layer = el('div', 'vo-zone-labels')
		for (const zone of this.session.layoutData.zones) {
			const label = el('div', 'vo-zone-label')
			label.textContent = this.options.zoneLabels[zone.id] ?? zone.id
			label.dataset.zone = zone.id
			const [x, y, w] = zone.rect
			label.style.left = `${(x + w / 2) * TILE}px`
			label.style.top = `${(zone.id === 'entrance' ? y + 1 : y + 0.35) * TILE + (zone.id === 'entrance' ? 8 : 18)}px`
			layer.append(label)
		}
		return layer
	}

	private propLayer(): HTMLElement {
		const layer = el('div', 'vo-props')
		for (const prop of this.session.layoutData.props) {
			const fx = el('div', `vo-prop-fx vo-prop-${prop.id}`)
			fx.style.left = `${prop.cell[0] * TILE}px`
			fx.style.top = `${prop.cell[1] * TILE}px`
			fx.innerHTML = prop.id === 'coffee'
				? `<span></span><span></span><span></span><b class="vo-clink-cups"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="${mdiGlassMugVariant}"/></svg><svg viewBox="0 0 24 24" aria-hidden="true"><path d="${mdiGlassMugVariant}"/></svg></b>`
				: '<i></i><i></i><i></i><i></i>'
			this.propFx.set(prop.id, fx)
			layer.append(fx)
		}
		const player = this.session.layoutData.player
		if (player) {
			this.playerFx = el('div', 'vo-prop-fx vo-player-fx')
			this.playerFx.style.left = `${player.cell[0] * TILE}px`
			this.playerFx.style.top = `${player.cell[1] * TILE}px`
			this.playerFx.innerHTML = '<i>♪</i><i>♫</i><i>♪</i>'
			layer.append(this.playerFx)
		}
		return layer
	}

	private fit(): void {
		const layout = this.session.layoutData
		const available = this.root.clientWidth || layout.width * TILE
		const scale = Math.max(0.55, Math.min(1.25, available / (layout.width * TILE)))
		this.scale = scale
		this.stage.style.transform = `scale(${scale})`
		this.viewport.style.height = `${layout.height * TILE * scale}px`
		this.viewport.style.setProperty('--vo-stage-width', `${layout.width * TILE * scale}px`)
	}

	/** Keeps your own character in view when the map is wider than the screen. */
	private follow(): void {
		const overflow = this.root.scrollWidth - this.root.clientWidth
		if (overflow <= 0 || performance.now() - this.userScrolledAt < 3000) {
			return
		}
		const position = this.session.ownPosition()
		if (!position) {
			return
		}
		const target = position[0] * TILE * this.scale - this.root.clientWidth / 2
		const current = this.root.scrollLeft
		this.root.scrollLeft = current + (Math.max(0, Math.min(overflow, target)) - current) * 0.12
	}

	private on(target: EventTarget, type: string, handler: (event: Event) => void, options?: AddEventListenerOptions): void {
		target.addEventListener(type, handler, options)
		this.cleanup.push(() => target.removeEventListener(type, handler, options))
	}
}

function el(tag: string, className: string): HTMLElement {
	const node = document.createElement(tag)
	node.className = className
	return node
}
