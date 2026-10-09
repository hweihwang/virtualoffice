/**
 * SPDX-FileCopyrightText: 2026 Hoang Pham
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * The launch film as one deterministic page: window.seek(t) draws the frame
 * at t seconds. The office and the characters are the app's own SVG artwork;
 * the camera, the type and the Talk window around the office are drawn here.
 */
import type { Appearance, Cell } from '../../../shared/catalog.ts'
import type { Facing } from '../../../src/scene/sprites.ts'

import { mdiAccountMultiple, mdiCalendarBlankOutline, mdiCheck, mdiCheckAll, mdiDockLeft, mdiDockRight, mdiDotsHorizontal, mdiEmoticonLol, mdiEmoticonOutline, mdiHandWave, mdiHeart, mdiHeartMultiple, mdiMagnify, mdiMicrophone, mdiPartyPopper, mdiPhone, mdiPlus, mdiTimerSand } from '@mdi/js'
import { catalog, getLayout } from '../../../shared/catalog.ts'
import { findPath } from '../../../shared/movement.ts'
import { mapSvg } from '../../../src/scene/map.ts'
import { creatureSvg } from '../../../src/scene/sprites.ts'
import logoSvg from '../../../docs/media/logo.svg?raw'
import './film.css'

export const FPS = 60
export const DURATION = 44
const TILE = 40
const W = 1920
const H = 1080
const layout = getLayout(catalog.defaultLayout)
const decor = { floor: 'oak', rug: 'sunrise', wallArt: 'mountains', lights: 'warm' }

// Easing: one family for the camera, quint in and quad out for type.
const clamp01 = (x: number) => Math.max(0, Math.min(1, x))
const prog = (t: number, a: number, b: number) => clamp01((t - a) / (b - a))
const inOutCubic = (x: number) => x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2
const outQuint = (x: number) => 1 - (1 - x) ** 5
const outCubic = (x: number) => 1 - (1 - x) ** 3
const inQuad = (x: number) => x * x
const outBack = (x: number) => {
	const c = 1.4
	return 1 + (c + 1) * (x - 1) ** 3 + c * (x - 1) ** 2
}
const lerp = (a: number, b: number, x: number) => a + (b - a) * x
const icon = (path: string, fill = 'currentColor', cls = '') => `<svg viewBox="0 0 24 24" class="${cls}" aria-hidden="true"><path d="${path}" fill="${fill}"/></svg>`

function el<T extends HTMLElement = HTMLDivElement>(tag: string, className = '', html = ''): T {
	const node = document.createElement(tag) as T
	if (className) {
		node.className = className
	}
	if (html) {
		node.innerHTML = html
	}
	return node
}

/* ------------------------------------------------------------------ camera */

// Monotone cubic (Fritsch–Carlson) so the camera never overshoots a hold.
function monotone(xs: number[], ys: number[]): (x: number) => number {
	const n = xs.length
	const d = xs.slice(1).map((x, i) => (ys[i + 1] - ys[i]) / (x - xs[i]))
	const m = xs.map((_, i) => i === 0 ? d[0] : i === n - 1 ? d[n - 2] : (d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2))
	for (let i = 0; i < n - 1; i++) {
		if (d[i] === 0) {
			m[i] = m[i + 1] = 0
			continue
		}
		const a = m[i] / d[i]
		const b = m[i + 1] / d[i]
		const s = a * a + b * b
		if (s > 9) {
			const k = 3 / Math.sqrt(s)
			m[i] = k * a * d[i]
			m[i + 1] = k * b * d[i]
		}
	}
	return (x: number) => {
		if (x <= xs[0]) {
			return ys[0]
		}
		if (x >= xs[n - 1]) {
			return ys[n - 1]
		}
		let i = 0
		while (x > xs[i + 1]) {
			i++
		}
		const h = xs[i + 1] - xs[i]
		const u = (x - xs[i]) / h
		const h00 = 2 * u ** 3 - 3 * u ** 2 + 1
		const h10 = u ** 3 - 2 * u ** 2 + u
		const h01 = -2 * u ** 3 + 3 * u ** 2
		const h11 = u ** 3 - u ** 2
		return h00 * ys[i] + h10 * h * m[i] + h01 * ys[i + 1] + h11 * h * m[i + 1]
	}
}

// [time, centre x, centre y, zoom] in stage pixels.
const KEYS: [number, number, number, number][] = [
	[0.0, 140, 26, 30],
	[2.8, 140, 30, 25],
	[5.0, 138, 62, 12],
	[7.4, 141, 85, 7.4],
	[9.2, 152, 100, 6.2],
	[11.8, 440, 212, 2.75],
	[14.4, 470, 216, 2.6],
	[16.3, 760, 250, 2.2],
	[18.2, 1005, 165, 3.5],
	[21.4, 1012, 168, 3.7],
	[23.4, 1040, 330, 4.4],
	[26.8, 1046, 345, 4.55],
	[29.8, 640, 296, 0.97],
	[33.9, 640, 300, 0.935],
	[36.9, -143, 240, 0.535],
	[39.3, -135, 240, 0.52],
	[42.0, -120, 240, 0.49],
]
const camX = monotone(KEYS.map((k) => k[0]), KEYS.map((k) => k[1]))
const camY = monotone(KEYS.map((k) => k[0]), KEYS.map((k) => k[2]))
const camZ = monotone(KEYS.map((k) => k[0]), KEYS.map((k) => Math.log(k[3])))

const softMax = (a: number, b: number, k: number) => (a + b + Math.sqrt((a - b) ** 2 + k * k)) / 2
const softMin = (a: number, b: number, k: number) => (a + b - Math.sqrt((a - b) ** 2 + k * k)) / 2

function camera(t: number): { x: number, y: number, z: number } {
	const z = Math.exp(camZ(t))
	let x = camX(t)
	let y = camY(t)
	// Until the office floats free, never show past its walls.
	const keep = 1 - inOutCubic(prog(t, 27.2, 29.2))
	if (keep > 0) {
		const hx = W / 2 / z
		const hy = H / 2 / z
		// Soft limits, so the camera eases into a wall instead of stopping dead.
		const cx = hx * 2 < 1280 ? softMin(softMax(x, hx, 60 / z), 1280 - hx, 60 / z) : 640
		const cy = hy * 2 < 800 ? softMin(softMax(y, hy, 60 / z), 800 - hy, 60 / z) : 400
		x = lerp(x, cx, keep)
		y = lerp(y, cy, keep)
	}
	return { x, y, z }
}

/* ------------------------------------------------------------------- cast */

interface Walk { at: number, from: Cell, to: Cell, path?: Cell[] }
interface Emote { id: 'wave' | 'heart' | 'laugh' | 'celebrate', at: number, until: number, paired?: boolean }
interface Person {
	id: string
	name: string
	appearance: Appearance
	cell: Cell
	facing: Facing | 'west'
	end?: Facing | 'west'
	you?: boolean
	focusing?: boolean
	walks?: Walk[]
	emotes?: Emote[]
	enters?: number
	phase: number
}

const EMOTE_ICON = { wave: mdiHandWave, heart: mdiHeart, laugh: mdiEmoticonLol, celebrate: mdiPartyPopper }
const EMOTE_FILL = { wave: '#d9934a', heart: '#e0565b', laugh: '#d3a322', celebrate: '#7a5bc4' }

const cast: Person[] = [
	{ id: 'alice', name: 'Alice (you)', you: true, appearance: { creature: 'rabbit', palette: 'rose', accessory: 'scarf' }, cell: [4, 2], facing: 'west', end: 'west', walks: [{ at: 9.3, from: [4, 2], to: [9, 4] }], emotes: [{ id: 'heart', at: 31.0, until: 34.3, paired: true }], phase: 0.1 },
	{ id: 'bao', name: 'Bảo', appearance: { creature: 'cat', palette: 'sky', accessory: 'flower' }, cell: [2, 2], facing: 'east', end: 'east', walks: [{ at: 9.55, from: [2, 2], to: [6, 4] }], emotes: [{ id: 'wave', at: 12.05, until: 14.8 }, { id: 'heart', at: 30.9, until: 34.3, paired: true }], phase: 0.55 },
	{ id: 'gus', name: 'Gus', appearance: { creature: 'bear', palette: 'slate', accessory: 'beanie' }, cell: [17, 6], facing: 'west', end: 'south', walks: [{ at: 13.65, from: [17, 6], to: [8, 7] }], emotes: [{ id: 'wave', at: 12.85, until: 15.0 }], phase: 0.3 },
	{ id: 'chi', name: 'Chi', appearance: { creature: 'bear', palette: 'cocoa', accessory: 'glasses' }, cell: [24, 4], facing: 'south', focusing: true, phase: 0.8 },
	{ id: 'emil', name: 'Emil', appearance: { creature: 'cat', palette: 'sage', accessory: 'none' }, cell: [28, 4], facing: 'south', focusing: true, phase: 0.2 },
	{ id: 'fern', name: 'Fern', appearance: { creature: 'bird', palette: 'lilac', accessory: 'flower' }, cell: [5, 17], facing: 'north', end: 'north', enters: 27.4, walks: [{ at: 28.1, from: [5, 17], to: [15, 11] }], phase: 0.65 },
]
const EDGE = catalog.movement.msPerEdge / 1000

for (const person of cast) {
	for (const walk of person.walks ?? []) {
		const path = findPath(layout, walk.from, walk.to)
		if (!path) {
			throw new Error(`No path for ${person.id}`)
		}
		walk.path = path
	}
}

function pose(person: Person, t: number): { x: number, y: number, facing: Facing | 'west', walking: boolean } {
	let cell: [number, number] = [...person.cell]
	let facing = person.facing
	for (const walk of person.walks ?? []) {
		const path = walk.path!
		const edges = path.length - 1
		const k = (t - walk.at) / EDGE
		if (k < 0) {
			break
		}
		if (k >= edges) {
			cell = [...path[edges]]
			facing = person.end ?? facing
			continue
		}
		const i = Math.floor(k)
		const u = k - i
		const [ax, ay] = path[i]
		const [bx, by] = path[i + 1]
		cell = [ax + (bx - ax) * u, ay + (by - ay) * u]
		facing = bx > ax ? 'east' : bx < ax ? 'west' : by > ay ? 'south' : 'north'
		return { x: cell[0], y: cell[1], facing, walking: true }
	}
	return { x: cell[0], y: cell[1], facing, walking: false }
}

/* ------------------------------------------------------------------ build */

const frame = document.getElementById('frame')!
const add = (parent: HTMLElement, node: HTMLElement) => {
	parent.append(node)
	return node
}

const backdrop = add(frame, el('div', 'layer', '')) as HTMLDivElement
backdrop.id = 'backdrop'
const world = add(frame, el('div')) as HTMLDivElement
world.id = 'world'

// Talk, behind the office.
const WIN = { x: -380, y: -700, w: 1860, h: 1880 }
const talk = add(world, el('div')) as HTMLDivElement
talk.id = 'talk'
talk.style.cssText = `left:${WIN.x}px;top:${WIN.y}px;width:${WIN.w}px;height:${WIN.h}px`
const talkInner = add(talk, el('div')) as HTMLDivElement
talkInner.style.cssText = `position:absolute;left:0;top:0;transform:translate(${-WIN.x}px,${-WIN.y}px)`
const talkParts: { node: HTMLElement, at: number }[] = []
function part(html: string, x: number, y: number, at: number, className = 'part', width?: number, height?: number): HTMLElement {
	const node = el('div', className, html)
	node.style.left = `${x}px`
	node.style.top = `${y}px`
	if (width) {
		node.style.width = `${width}px`
	}
	if (height) {
		node.style.height = `${height}px`
	}
	talkInner.append(node)
	talkParts.push({ node, at })
	return node
}
part('', WIN.x, WIN.y, 34.3, 'part window', WIN.w, WIN.h)
part(`<div class="t-header">${icon(mdiDockLeft, '#222', 't-icon')}<div class="t-avatar">${icon(mdiAccountMultiple, '#fff')}</div><div class="t-title">Studio chat</div>${icon(mdiCalendarBlankOutline, '#222', 't-icon')}<div class="t-call">${icon(mdiPhone, '#fff')}Start call</div>${icon(mdiMagnify, '#222', 't-icon')}${icon(mdiDotsHorizontal, '#222', 't-icon')}${icon(mdiDockRight, '#222', 't-icon')}</div>`, WIN.x, WIN.y, 34.85, 'part', WIN.w)
part('<div class="t-date">Today</div>', WIN.x + WIN.w / 2, -566, 35.05)
part('<div class="t-face" style="background:#fbe3ea;color:#c2506f">B</div>', -330, -470, 35.2)
part('<div class="t-name">Bảo</div>', -250, -498, 35.2)
part('<div class="t-msg">Anyone free for a quick question about the launch?<div class="t-time">10:24</div></div>', -250, -456, 35.25)
part(`<div class="t-own" style="position:absolute;inset:0"><div class="t-text">Come by the office: <span class="t-link">cloud.example.com/apps/virtualoffice/o/2ed0c4b6</span></div></div>`, -60, -300, 34.5, 'part', 1400, 1300)
part('<div class="t-face" style="background:#ece6f7;color:#6a55a8">A</div>', 1364, -300, 35.45)
part('', -30, -200, 34.6, 'part t-card', 1340, 1130)
part(`<div class="t-card-head"><div class="t-thumb">${mapSvg(catalog.defaultLayout, decor).replace('<svg ', '<svg preserveAspectRatio="xMidYMid slice" ')}</div><div><div class="t-card-title">The Studio</div><div class="t-card-meta">Studio team · 6 here</div><div class="t-card-open">Open office</div></div></div>`, 0, -178, 35.6)
part(`<div class="t-row">${(['wave', 'heart', 'laugh', 'celebrate'] as const).map((e) => `<div class="t-react">${icon(EMOTE_ICON[e], '#222')}</div>`).join('')}<div class="grow"></div><div class="t-here">6 here</div><div class="t-btn">Open full office</div><div class="t-btn">Leave</div></div>`, 0, 830, 35.8, 'part', 1280)
part(`<div class="t-time" style="display:flex;gap:8px;align-items:center;justify-content:flex-end">10:25 ${icon(mdiCheckAll, '#7a7a7a').replace('<svg ', '<svg style="width:28px;height:28px" ')}</div>`, 1100, 950, 35.9, 'part', 210)
part(`<div class="t-composer">${icon(mdiPlus, '#222', 't-icon')}<div class="t-input">${icon(mdiEmoticonOutline, '#8b8b8b', 't-icon')}Write a message …</div>${icon(mdiDotsHorizontal, '#222', 't-icon')}${icon(mdiMicrophone, '#222', 't-icon')}</div>`, -330, 1060, 36.0, 'part', 1760)

// The office.
const stageShadow = add(world, el('div')) as HTMLDivElement
stageShadow.id = 'stage-shadow'
const stageWrap = add(world, el('div')) as HTMLDivElement
stageWrap.id = 'stage-wrap'
const stage = add(stageWrap, el('div')) as HTMLDivElement
stage.id = 'stage'
const map = add(stage, el('div', '', mapSvg(catalog.defaultLayout, decor)))
map.id = 'map'
const bulbs = [...map.querySelectorAll<SVGCircleElement>('.vo-bulb')]
const leaves = map.querySelector<SVGGElement>('.vo-shared-plant .vo-leaves')!
leaves.style.transformBox = 'fill-box'
leaves.style.transformOrigin = '50% 100%'

const zonesLayer = add(stage, el('div', 'stage-layer'))
const ZONE_NAMES: Record<string, string> = { entrance: 'Entrance', coffee: 'Coffee corner', common: 'Common room', focus: 'Focus desks' }
const ZONE_COLORS: Record<string, string> = { entrance: '#5eb998', coffee: '#f19b57', common: '#0082c9', focus: '#8275ca' }
for (const zone of layout.zones) {
	const label = add(zonesLayer, el('div', 'zone'))
	label.textContent = ZONE_NAMES[zone.id]
	label.style.setProperty('--zone', ZONE_COLORS[zone.id])
	const [x, y, w] = zone.rect
	label.style.left = `${(x + w / 2) * TILE}px`
	label.style.top = `${(zone.id === 'entrance' ? y + 1 : y + 0.35) * TILE + (zone.id === 'entrance' ? 8 : 18)}px`
}

// Desks: Chi and Emil are in; Dana is out with her note.
const desksLayer = add(stage, el('div', 'stage-layer'))
function deskPlate(cell: Cell, html: string, inside: boolean): HTMLElement {
	const plate = add(desksLayer, el('div', `desk${inside ? ' inside' : ''}`, html))
	plate.style.left = `${cell[0] * TILE + TILE / 2}px`
	plate.style.top = `${(cell[1] - 1) * TILE}px`
	return plate
}
deskPlate([24, 4], '<span>Chi</span>', true)
deskPlate([28, 4], '<span>Emil</span>', true)
const dana = deskPlate([28, 9], '<span><i class="dot"></i>Dana</span><span class="note">Back after lunch</span>', false)
const danaNote = dana.querySelector<HTMLElement>('.note')!

// Props: steam over the coffee machine, drops over the shared plant.
const propsLayer = add(stage, el('div', 'stage-layer'))
const steam = Array.from({ length: 6 }, () => add(propsLayer, el('div', 'steam')))
const drops = Array.from({ length: 4 }, () => add(propsLayer, el('div', 'drop')))

const actorsLayer = add(stage, el('div', 'stage-layer'))
interface ActorView {
	person: Person
	root: HTMLElement
	sprite: HTMLElement
	facings: Record<string, HTMLElement>
	bodies: SVGGElement[]
	feetL: SVGEllipseElement[]
	feetR: SVGEllipseElement[]
	plate: HTMLElement
	bubble: HTMLElement
	bubbleIcon: HTMLElement
}
const actors: ActorView[] = cast.map((person) => {
	const root = add(actorsLayer, el('div', 'actor'))
	add(root, el('div', 'shadow'))
	const sprite = add(root, el('div', 'sprite'))
	const facings: Record<string, HTMLElement> = {}
	for (const facing of ['south', 'north', 'east'] as const) {
		facings[facing] = add(sprite, el('div', 'facing', creatureSvg(person.appearance, facing)))
	}
	const bubble = add(root, el('div', 'bubble'))
	const bubbleIcon = add(bubble, el('div'))
	const plate = add(root, el('div', `plate${person.you ? ' you' : ''}`, `<span class="mode"></span><span>${person.name}</span>${person.focusing ? icon(mdiTimerSand) : ''}`))
	return {
		person,
		root,
		sprite,
		facings,
		bodies: [...sprite.querySelectorAll<SVGGElement>('.vo-body')],
		feetL: [...sprite.querySelectorAll<SVGEllipseElement>('.vo-foot-l')],
		feetR: [...sprite.querySelectorAll<SVGEllipseElement>('.vo-foot-r')],
		plate,
		bubble,
		bubbleIcon,
	}
})
for (const actor of actors) {
	for (const body of actor.bodies) {
		body.style.transformBox = 'fill-box'
		body.style.transformOrigin = '50% 100%'
	}
}

const fxLayer = add(stage, el('div', 'stage-layer'))
// Coffee mugs in the app's line style, one per person.
function mugSvg(band: string, handleLeft: boolean): string {
	const ink = 'stroke="#173b58" stroke-linejoin="round" stroke-linecap="round"'
	const body = 'M3 4.6h10v7a2.6 2.6 0 0 1-2.6 2.6H5.6A2.6 2.6 0 0 1 3 11.6Z'
	const handle = handleLeft ? 'M3.1 6.4C.3 6.4.3 11 3.1 11' : 'M12.9 6.4c2.8 0 2.8 4.6 0 4.6'
	return `<svg viewBox="0 0 16 16" width="14" height="14"><path d="${handle}" fill="none" ${ink} stroke-width="1.4"/><path d="${body}" fill="#fff"/><rect x="3" y="8.3" width="10" height="2.5" fill="${band}"/><path d="${body}" fill="none" ${ink} stroke-width="1.3"/><ellipse cx="8" cy="4.7" rx="5" ry="1.45" fill="#8a5a3c" ${ink} stroke-width="1.1"/></svg>`
}
const mugs = [mugSvg('#9cc8eb', true), mugSvg('#efa3b8', false)].map((svg) => add(actorsLayer, el('div', 'mug', svg)))
const mugSteam = Array.from({ length: 4 }, () => add(fxLayer, el('div', 'steam small')))
const sparks = Array.from({ length: 7 }, () => add(fxLayer, el('div', 'spark')))
const pair = add(fxLayer, el('div', 'pair', icon(mdiHeartMultiple, '#e0565b')))
const ripples = [0, 1].map(() => add(fxLayer, el('div', 'ripple')))
const focusChip = add(fxLayer, el('div', 'focus-chip', `${icon(mdiTimerSand)}<span>Focus together · 24:13</span>`))
const focusTime = focusChip.querySelector('span')!
focusChip.style.left = '1060px'
focusChip.style.top = '84px'
const knock = add(fxLayer, el('div', 'knock', `<div class="who"><span class="face">${creatureSvg(cast[0].appearance, 'south')}</span>Alice knocked</div><div class="ask">Got 2 minutes?</div><div class="answers"><b>Now</b><b>In 10 minutes</b><b>Later</b></div>`))
const pick = knock.querySelectorAll<HTMLElement>('.answers b')[1]
const reply = add(fxLayer, el('div', 'reply', `${icon(mdiCheck)}In 10 minutes`))

// Screen space.
const tiltTop = add(frame, el('div', 'tilt'))
tiltTop.id = 'tilt-top'
const tiltBottom = add(frame, el('div', 'tilt'))
tiltBottom.id = 'tilt-bottom'
const scrim = add(frame, el('div', 'layer'))
scrim.id = 'scrim'

interface Line { node: HTMLElement, words: HTMLElement[], at: number, out: number }
function words(parent: HTMLElement, text: string, extra: (i: number) => string = () => ''): HTMLElement[] {
	return text.split(' ').map((word, i, all) => {
		const node = add(parent, el('span', `word ${extra(i)}`))
		node.textContent = word + (i < all.length - 1 ? ' ' : '')
		return node
	})
}
const captions: Line[] = [
	['It starts with a coffee.', 5.9, 9.35],
	['A wave from across the room.', 11.8, 15.1],
	['A quick knock before a call.', 18.5, 21.9],
	['And a note when you’re out.', 23.7, 27.1],
].map(([text, at, out]) => {
	const node = add(frame, el('div', 'caption'))
	return { node, words: words(node, text as string), at: at as number, out: out as number }
})

const title = add(frame, el('div'))
title.id = 'title'
const titleA = words(title, 'See who’s around.')
add(title, el('span', 'word')).textContent = ' '
const titleB = words(title, 'Drop by.', () => 'dim')

const side = add(frame, el('div'))
side.id = 'side'
const sideA = words(add(side, el('div')), 'Right inside')
const sideB = words(add(side, el('div')), 'your team chat.')

const end = add(frame, el('div', 'layer'))
end.id = 'end'
const endLogo = add(end, el('div', 'logo', logoSvg))
const endTitle = add(end, el('h1', '', 'Virtual Office'))
const endSub = add(end, el('p', '', 'A small shared office for Nextcloud'))
const endCast = add(end, el('div', 'cast'))
const castNodes = ['bao', 'chi', 'alice', 'fern', 'emil', 'gus'].map((id) => add(endCast, el('div', 'cast-one', creatureSvg(cast.find((p) => p.id === id)!.appearance, 'south'))))
const endSmall = add(end, el('div', 'small', 'Free and open source · <i>hweihwang.com/virtualoffice</i>'))

const vignette = add(frame, el('div', 'layer'))
vignette.id = 'vignette'
const grain = add(frame, el('div', 'layer'))
grain.id = 'grain'
const fade = add(frame, el('div', 'layer'))
fade.id = 'fade'
// The warm light sits above the fade, so it blooms out of the dark.
const bloom = add(frame, el('div', 'layer'))
bloom.id = 'bloom'

// Film grain: a few seeded noise tiles, cycled per frame.
function mulberry(seed: number): () => number {
	return () => {
		seed |= 0
		seed = seed + 0x6D2B79F5 | 0
		let r = Math.imul(seed ^ seed >>> 15, 1 | seed)
		r = r + Math.imul(r ^ r >>> 7, 61 | r) ^ r
		return ((r ^ r >>> 14) >>> 0) / 4294967296
	}
}
const grainTiles = Array.from({ length: 6 }, (_, k) => {
	const canvas = document.createElement('canvas')
	canvas.width = canvas.height = 256
	const ctx = canvas.getContext('2d')!
	const image = ctx.createImageData(256, 256)
	const rand = mulberry(1000 + k)
	for (let i = 0; i < image.data.length; i += 4) {
		const v = 128 + (rand() - 0.5) * 120
		image.data[i] = image.data[i + 1] = image.data[i + 2] = v
		image.data[i + 3] = 255
	}
	ctx.putImageData(image, 0, 0)
	return `url(${canvas.toDataURL()})`
})

/* ------------------------------------------------------------------- draw */

function showWords(list: HTMLElement[], t: number, at: number, out: number, stagger = 0.085, rise = 20): void {
	list.forEach((node, i) => {
		const a = outQuint(prog(t, at + i * stagger, at + i * stagger + 1.0))
		const o = inQuad(prog(t, out, out + 0.55))
		const v = a * (1 - o)
		node.style.opacity = v.toFixed(4)
		node.style.filter = v < 0.999 ? `blur(${((1 - a) * 10 + o * 6).toFixed(2)}px)` : 'none'
		node.style.transform = `translateY(${((1 - a) * rise - o * 6).toFixed(2)}px)`
	})
}

function pop(node: HTMLElement, t: number, at: number, until: number, base = ''): number {
	const a = prog(t, at, at + 0.32)
	const o = prog(t, until - 0.3, until)
	const v = a > 0 && o < 1 ? 1 : 0
	const s = lerp(0.4, 1, outBack(a)) * lerp(1, 0.85, inQuad(o))
	node.style.opacity = (clamp01(a * 3) * (1 - o) * v).toFixed(4)
	node.style.transform = `${base} translateY(${((1 - outCubic(a)) * 10).toFixed(2)}px) scale(${s.toFixed(4)})`
	return a * (1 - o)
}

function waveAngle(t: number): number {
	// vo-wave: 600 ms, three times.
	if (t < 0 || t > 1.8) {
		return 0
	}
	const u = (t % 0.6) / 0.6
	const k = [[0, 0], [0.25, -18], [0.75, 14], [1, 0]]
	for (let i = 0; i < 3; i++) {
		if (u <= k[i + 1][0]) {
			const x = (u - k[i][0]) / (k[i + 1][0] - k[i][0])
			return lerp(k[i][1], k[i + 1][1], 0.5 - Math.cos(Math.PI * x) / 2)
		}
	}
	return 0
}

function seek(t: number): void {
	const cam = camera(t)
	const z = cam.z
	world.style.transform = `translate(${(W / 2 - cam.x * z).toFixed(3)}px, ${(H / 2 - cam.y * z).toFixed(3)}px) scale(${z.toFixed(5)})`

	// Opening: a warm light, then focus pulls onto the steam.
	const focus = outCubic(prog(t, 0.5, 3.4))
	world.style.filter = focus < 1 ? `blur(${((1 - focus) * 26).toFixed(2)}px)` : 'none'
	const open = inOutCubic(prog(t, 0.35, 2.9))
	const close = inOutCubic(prog(t, 43.0, 44.0))
	fade.style.opacity = Math.max(1 - open, 0).toFixed(4)
	bloom.style.opacity = (outCubic(prog(t, 0.1, 1.7)) * lerp(0.95, 0.0, inOutCubic(prog(t, 1.9, 7.5)))).toFixed(4)
	bloom.style.transform = `scale(${lerp(0.55, 1.25, outCubic(prog(t, 0.1, 4)))})`

	// The office floats free after the big pull back; its backdrop warms up.
	backdrop.style.opacity = inOutCubic(prog(t, 26.8, 29.6)).toFixed(4)
	stageShadow.style.opacity = (inOutCubic(prog(t, 27.5, 29.5)) * (1 - inOutCubic(prog(t, 34.5, 35.8)))).toFixed(4)

	// Tilt-shift: strongest close up, gone once the whole office is in view.
	const blur = 9 * clamp01((Math.log(z) - Math.log(1.7)) / (Math.log(7) - Math.log(1.7)))
	tiltTop.style.backdropFilter = tiltBottom.style.backdropFilter = blur > 0.05 ? `blur(${blur.toFixed(2)}px)` : 'none'
	tiltTop.style.display = tiltBottom.style.display = blur > 0.05 ? 'block' : 'none'
	scrim.style.opacity = (clamp01((Math.log(z) - Math.log(1.3)) / (Math.log(2.6) - Math.log(1.3))) * inOutCubic(prog(t, 3.8, 5.6))).toFixed(4)

	// Warm bulbs breathe, the shared plant sways while Fern waters it.
	bulbs.forEach((bulb, i) => bulb.setAttribute('opacity', (0.825 + 0.175 * Math.sin((t / 3) * Math.PI + (i % 2) * Math.PI)).toFixed(3)))
	const watering = t > 32.4 && t < 34.4
	leaves.style.transform = watering ? `rotate(${(4 * Math.sin(((t - 32.4) / 0.5) * Math.PI)).toFixed(2)}deg)` : 'none'

	// Steam: the machine runs while Alice and Bảo make their coffee.
	steam.forEach((puff, i) => {
		const cycle = 1.8
		const local = t + i * (cycle / steam.length)
		const u = (local % cycle) / cycle
		const running = t < 10.2 || (t > 10.2 && local - (local % cycle) < 10.2)
		const alive = running ? 1 : 0
		const x = 132 + (i % 3) * 7 + Math.sin(local * 1.7 + i) * 2.5 * u
		puff.style.left = `${x.toFixed(2)}px`
		puff.style.top = '26px'
		puff.style.opacity = (alive * (u < 0.3 ? u / 0.3 : 1 - (u - 0.3) / 0.7) * 0.95).toFixed(3)
		puff.style.transform = `translateY(${(-30 * outCubic(u)).toFixed(2)}px) scale(${lerp(0.6, 1.9, u).toFixed(3)})`
	})
	drops.forEach((drop, i) => {
		const local = t - 32.4 - i * 0.2
		const u = (local % 0.8) / 0.8
		const on = local > 0 && t < 34.4
		drop.style.left = `${16 * TILE + [8, 18, 28, 14][i]}px`
		drop.style.top = `${10 * TILE - 26}px`
		drop.style.opacity = on ? (u < 0.2 ? u / 0.2 : 1 - (u - 0.2) / 0.8).toFixed(3) : '0'
		drop.style.transform = `translateY(${lerp(-10, 22, u * u).toFixed(2)}px)`
	})

	// People.
	const plates = clamp01((Math.log(5.2) - Math.log(z)) / (Math.log(5.2) - Math.log(3.9)))
	for (const actor of actors) {
		const { person } = actor
		const p = pose(person, t)
		const x = p.x * TILE + TILE / 2 - 24
		const y = p.y * TILE + TILE - 58
		const entering = person.enters === undefined ? 1 : outCubic(prog(t, person.enters, person.enters + 0.6))
		actor.root.style.transform = `translate(${x.toFixed(3)}px, ${y.toFixed(3)}px)`
		actor.root.style.zIndex = String(10 + Math.round(p.y * 10))
		actor.root.style.opacity = entering.toFixed(3)
		const facing = p.facing === 'west' ? 'east' : p.facing
		for (const [key, node] of Object.entries(actor.facings)) {
			node.classList.toggle('on', key === facing)
			node.classList.toggle('west', key === 'east' && p.facing === 'west')
		}
		// Walking bob and steps from the app, a slow breath while standing.
		const step = Math.floor(t / 0.125) % 2
		const bob = p.walking ? -2 * Math.sin(((t % 0.25) / 0.25) * Math.PI) : -0.7 * (0.5 - 0.5 * Math.cos(((t + person.phase * 3) / 3.2) * 2 * Math.PI))
		for (const body of actor.bodies) {
			body.style.transform = `translateY(${bob.toFixed(3)}px)`
		}
		actor.feetL.forEach((f) => { f.style.transform = p.walking && step === 0 ? 'translateY(-2.5px)' : 'none' })
		actor.feetR.forEach((f) => { f.style.transform = p.walking && step === 1 ? 'translateY(-2.5px)' : 'none' })
		actor.sprite.style.transform = `scale(${1.45 * lerp(0.9, 1, entering)})`
		actor.plate.style.opacity = (plates * (person.enters === undefined ? 1 : entering)).toFixed(3)
		// Reactions.
		const emote = (person.emotes ?? []).find((e) => !e.paired && t >= e.at - 0.05 && t <= e.until)
		if (emote) {
			if (actor.bubble.dataset.emote !== emote.id + emote.at) {
				actor.bubble.dataset.emote = emote.id + emote.at
				actor.bubbleIcon.innerHTML = icon(EMOTE_ICON[emote.id], EMOTE_FILL[emote.id])
			}
			pop(actor.bubble, t, emote.at, emote.until)
			const svg = actor.bubbleIcon.querySelector('svg')!
			const local = t - emote.at - 0.1
			svg.style.transformOrigin = emote.id === 'wave' ? '70% 80%' : '50% 50%'
			svg.style.transform = emote.id === 'wave'
				? `rotate(${waveAngle(local).toFixed(2)}deg)`
				: `scale(${(1 + 0.2 * Math.max(0, Math.sin((local / 0.7) * Math.PI)) * (local < 2.1 ? 1 : 0)).toFixed(3)})`
		} else {
			actor.bubble.style.opacity = '0'
		}
	}

	// Coffee: two mugs meet between Alice and Bảo, then go with them to the table.
	const lift = outBack(prog(t, 5.35, 5.85))
	const meet = inOutCubic(prog(t, 6.05, 6.78))
	const recoil = Math.sin(prog(t, 6.78, 6.98) * Math.PI) * 0.12
	const back = inOutCubic(prog(t, 6.98, 7.65))
	const reach = meet * (1 - back) - recoil
	mugs.forEach((mug, i) => {
		const person = cast[i === 0 ? 1 : 0]
		const p = pose(person, t)
		const side = p.facing === 'west' ? -1 : p.facing === 'north' ? -0.6 : 1
		const bob = p.walking ? -2 * Math.sin(((t % 0.25) / 0.25) * Math.PI) : 0
		let x = p.x * TILE + TILE / 2 + side * 15
		let y = p.y * TILE + TILE - 2 - 25 + bob
		const toward = i === 0 ? 1 : -1
		x = lerp(x, 140 - toward * 7, reach)
		y = lerp(y, 88, reach) - Math.sin(clamp01(reach) * Math.PI) * 5
		let angle = toward * 16 * reach
		// At the table the mugs join the cups already there.
		const settle = inOutCubic(prog(t, 11.2, 11.75))
		const [tx, ty] = i === 0 ? [303, 172] : [336, 178]
		x = lerp(x, tx, settle)
		y = lerp(y, ty, settle)
		angle *= 1 - settle
		mug.style.opacity = (clamp01(prog(t, 5.35, 5.6)) * (1 - prog(t, 11.5, 11.8))).toFixed(3)
		mug.style.transform = `translate(${(x - 7).toFixed(3)}px, ${(y - 7).toFixed(3)}px) rotate(${angle.toFixed(2)}deg) scale(${(lerp(0.5, 1, lift) * lerp(1, 0.8, settle)).toFixed(4)})`
		mug.style.zIndex = String(11 + Math.round(p.y * 10))
	})
	mugSteam.forEach((puff, i) => {
		const mug = mugs[i % 2]
		const local = t + (i >> 1) * 0.7
		const u = (local % 1.4) / 1.4
		const on = t > 5.9 && t < 9.2 ? 1 : 0
		const m = new DOMMatrix(mug.style.transform)
		puff.style.opacity = (on * (u < 0.3 ? u / 0.3 : 1 - (u - 0.3) / 0.7) * 0.9).toFixed(3)
		puff.style.transform = `translate(${(m.e + 5 + (i >> 1) * 3).toFixed(2)}px, ${(m.f - 4 - 12 * outCubic(u)).toFixed(2)}px) scale(${lerp(0.5, 1.3, u).toFixed(3)})`
	})
	const burst = prog(t, 6.76, 7.2)
	sparks.forEach((spark, i) => {
		const angle = -90 + (i - 3) * 26
		const r = 8 + outCubic(burst) * 9
		spark.style.opacity = burst > 0 && burst < 1 ? (1 - inQuad(burst)).toFixed(3) : '0'
		spark.style.transform = `translate(${140 - 1}px, ${80}px) rotate(${angle + 90}deg) translateY(${-r.toFixed(2)}px) scaleY(${lerp(1.2, 0.5, burst).toFixed(3)})`
	})

	// Bảo and Alice react together while the title is up.
	const pa = actors[1]
	const pb = actors[0]
	const ap = pose(pa.person, t)
	const bp = pose(pb.person, t)
	const px = ((ap.x + bp.x) / 2) * TILE + TILE / 2
	const py = Math.min(ap.y, bp.y) * TILE + TILE - 58 - 48
	pop(pair, t, 31.25, 34.3, `translate(${px.toFixed(2)}px, ${py.toFixed(2)}px)`)
	pair.querySelector('svg')!.style.transform = `scale(${(1 + 0.2 * Math.max(0, Math.sin(((t - 31.35) / 0.7) * Math.PI)) * (t - 31.35 < 2.1 && t > 31.35 ? 1 : 0)).toFixed(3)})`

	// Focus desks: a shared timer, then Alice knocks on Chi.
	const left = 24 * 60 + 13 - Math.max(0, Math.floor(t - 16))
	focusTime.textContent = `Focus together · ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`
	focusChip.style.opacity = (plates * (1 - prog(t, 26.5, 27.5))).toFixed(3)
	ripples.forEach((ring, i) => {
		const u = prog(t, 18.55 + i * 0.24, 18.55 + i * 0.24 + 0.7)
		ring.style.left = '980px'
		ring.style.top = '146px'
		ring.style.opacity = u > 0 && u < 1 ? ((1 - u) * 0.9).toFixed(3) : '0'
		ring.style.transform = `scale(${lerp(0.6, 2.1, outCubic(u)).toFixed(3)})`
	})
	knock.style.left = '786px'
	knock.style.top = '86px'
	const k = pop(knock, t, 18.95, 21.05)
	knock.style.transformOrigin = '100% 60%'
	const press = prog(t, 20.15, 20.45)
	pick.classList.toggle('pick', t >= 20.3)
	pick.style.transform = `scale(${(1 - 0.08 * Math.sin(press * Math.PI)).toFixed(3)})`
	void k
	reply.style.left = '900px'
	reply.style.top = '146px'
	pop(reply, t, 20.95, 23.2, 'translateX(-50%)')

	// Dana's note, then the zone labels for the whole office.
	const note = outCubic(prog(t, 23.9, 24.7))
	danaNote.style.opacity = note.toFixed(3)
	danaNote.style.transform = `translateY(${((1 - note) * -6).toFixed(2)}px) scale(${lerp(0.92, 1, note).toFixed(3)})`
	zonesLayer.style.opacity = outCubic(prog(t, 28.6, 29.6)).toFixed(3)

	// Talk builds around the office.
	for (const { node, at } of talkParts) {
		const big = node.classList.contains('window') || node.classList.contains('t-card') || node.firstElementChild?.classList.contains('t-own')
		const a = big ? 1 : outQuint(prog(t, at, at + 0.9))
		node.style.opacity = a.toFixed(4)
		node.style.transform = big ? 'none' : `translateY(${((1 - a) * 14).toFixed(2)}px)`
	}
	// The chat opens outward from the office, like a door.
	const reveal = inOutCubic(prog(t, 34.35, 36.4))
	const inset = [700, 200, 380, 380].map((v) => lerp(v, -160, reveal).toFixed(2) + 'px')
	talk.style.opacity = t < 34.35 ? '0' : '1'
	talk.style.clipPath = `inset(${inset.join(' ')} round ${lerp(26, 34, reveal).toFixed(2)}px)`
	const leave = inOutCubic(prog(t, 39.3, 40.7))
	world.style.opacity = (1 - leave).toFixed(4)
	if (leave > 0) {
		world.style.filter = `blur(${(leave * 10).toFixed(2)}px)`
	}

	// Type.
	for (const line of captions) {
		const on = t > line.at - 0.1 && t < line.out + 1
		line.node.style.display = on ? 'block' : 'none'
		if (on) {
			showWords(line.words, t, line.at, line.out)
		}
	}
	const titleOn = t > 29.8 && t < 35
	title.style.display = titleOn ? 'block' : 'none'
	if (titleOn) {
		showWords(titleA, t, 30.0, 34.0, 0.1, 24)
		showWords(titleB, t, 31.15, 34.05, 0.12, 24)
	}
	const sideOn = t > 35.7 && t < 40
	side.style.display = sideOn ? 'flex' : 'none'
	if (sideOn) {
		showWords(sideA, t, 35.95, 39.05, 0.1, 22)
		showWords(sideB, t, 36.25, 39.1, 0.1, 22)
	}

	// End card.
	const endOn = t > 39.8
	end.style.display = endOn ? 'flex' : 'none'
	if (endOn) {
		const l = outQuint(prog(t, 40.0, 41.3))
		endLogo.style.opacity = (l * (1 - close)).toFixed(4)
		endLogo.style.transform = `translateY(${((1 - l) * 18).toFixed(2)}px) scale(${lerp(0.86, 1, l).toFixed(4)})`
		for (const [node, at] of [[endTitle, 40.35], [endSub, 40.75], [endSmall, 41.55]] as const) {
			const a = outQuint(prog(t, at, at + 1.0))
			node.style.opacity = (a * (1 - close)).toFixed(4)
			node.style.filter = a < 0.999 ? `blur(${((1 - a) * 8).toFixed(2)}px)` : 'none'
			node.style.transform = `translateY(${((1 - a) * 16).toFixed(2)}px)`
		}
	}

	if (endOn) {
		castNodes.forEach((node, i) => {
			const a = prog(t, 41.0 + i * 0.075, 41.0 + i * 0.075 + 0.55)
			const breathe = -1.2 * (0.5 - 0.5 * Math.cos(((t + i * 0.4) / 2.6) * 2 * Math.PI))
			node.style.opacity = (clamp01(a * 2.5) * (1 - close)).toFixed(4)
			node.style.transform = `translateY(${((1 - outBack(a)) * 22 + breathe).toFixed(2)}px)`
		})
	}

	// Finish: vignette and grain.
	vignette.style.opacity = (lerp(1, 0.75, prog(t, 4, 10)) * lerp(1, 0.55, inOutCubic(prog(t, 34.5, 36.5)) * (1 - prog(t, 39.3, 40.5)))).toFixed(3)
	// Grain changes at 30 Hz, like film, and costs fewer bits.
	const f = Math.floor(t * 30)
	const rand = mulberry(f * 7919)
	grain.style.backgroundImage = grainTiles[f % grainTiles.length]
	grain.style.backgroundPosition = `${Math.floor(rand() * 256)}px ${Math.floor(rand() * 256)}px`
	grain.style.opacity = '0.05'
}

declare global {
	interface Window {
		seek: (t: number) => void
		ready: Promise<void>
		film: { fps: number, duration: number }
	}
}
window.seek = seek
Object.assign(window, { camera })
window.film = { fps: FPS, duration: DURATION }
window.ready = document.fonts.ready.then(async () => {
	await Promise.all(['Fraunces', 'Source Sans 3'].flatMap((family) => [400, 600].map((weight) => document.fonts.load(`${weight} 20px "${family}"`, 'Bảo abc'))))
	await document.fonts.load('italic 600 20px Fraunces')
	seek(0)
})
