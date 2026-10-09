/**
 * SPDX-FileCopyrightText: 2026 Hoang Pham
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
import type { Layout } from '../../shared/catalog.ts'

import { getLayout } from '../../shared/catalog.ts'

/**
 * Background artwork for each office layout, drawn from the layout so the
 * furniture sits exactly on blocked cells. Decor choices only change colours
 * and ornaments, never collision.
 */
const T = 40
const INK = '#16435f'

const FLOORS: Record<string, [string, string]> = {
	oak: ['#f7f3ed', '#e7ddcf'],
	mint: ['#e7f7f2', '#c9e8df'],
	lavender: ['#f0effb', '#d9d7ef'],
	slate: ['#e4ecf3', '#c9d9e5'],
}

const RUGS: Record<string, [string, string] | null> = {
	sunrise: ['#b9e7f8', '#f5ad79'],
	ocean: ['#8fc3ef', '#3179be'],
	meadow: ['#a4e2d0', '#42ae9b'],
	none: null,
}

const px = (cells: number) => cells * T

function rect(x: number, y: number, w: number, h: number, fill: string, extra = ''): string {
	return `<rect x="${px(x)}" y="${px(y)}" width="${px(w)}" height="${px(h)}" fill="${fill}" ${extra}/>`
}

function planks(x: number, y: number, w: number, h: number, [a, b]: [string, string]): string {
	let out = rect(x, y, w, h, a)
	for (let row = 0; row < h * 2; row++) {
		const yy = px(y) + row * (T / 2)
		out += `<line x1="${px(x)}" y1="${yy}" x2="${px(x + w)}" y2="${yy}" stroke="${b}" stroke-width="1.5"/>`
		for (let col = (row % 2) * 60; col < px(w); col += 120) {
			out += `<line x1="${px(x) + col}" y1="${yy}" x2="${px(x) + col}" y2="${yy + T / 2}" stroke="${b}" stroke-width="1.5"/>`
		}
	}
	return out
}

function tiles(x: number, y: number, w: number, h: number, a: string, b: string): string {
	let out = rect(x, y, w, h, a)
	for (let yy = y; yy < y + h; yy++) {
		for (let xx = x; xx < x + w; xx++) {
			if ((xx + yy) % 2 === 0) {
				out += rect(xx, yy, 1, 1, b)
			}
		}
	}
	return out
}

function carpet(x: number, y: number, w: number, h: number): string {
	let out = rect(x, y, w, h, '#dceffa')
	for (let yy = y; yy < y + h; yy += 2) {
		for (let xx = x; xx < x + w; xx += 2) {
			out += `<circle cx="${px(xx) + 20}" cy="${px(yy) + 20}" r="1.5" fill="#a8cde3"/>`
		}
	}
	return out
}

function wallBlock(x: number, y: number, w: number, h: number): string {
	return rect(x, y, w, h, '#155b88')
		+ `<rect x="${px(x)}" y="${px(y)}" width="${px(w)}" height="7" fill="#318dbb"/>`
		+ `<path d="M${px(x)} ${px(y + h) - 3}h${px(w)}" stroke="#0b426c" stroke-width="3"/>`
}

function connectionMark(cx: number, cy: number, scale = 1, color = '#fff'): string {
	return `<g transform="translate(${cx} ${cy}) scale(${scale})" fill="${color}">`
		+ '<path d="M-20 -2h40v4h-40z"/><circle cx="-20" r="6"/><circle r="9"/><circle cx="20" r="6"/>'
		+ '</g>'
}

function plant(cx: number, cy: number, scale = 1): string {
	const s = scale
	return `<g transform="translate(${cx} ${cy}) scale(${s})">`
		+ '<ellipse cx="0" cy="17" rx="15" ry="5" fill="#16435f30"/>'
		+ `<g class="vo-leaves"><ellipse cx="-8" cy="-10" rx="6" ry="11" transform="rotate(-30 -8 -10)" fill="#51b99b" stroke="${INK}" stroke-width="1.3"/>`
		+ `<ellipse cx="8" cy="-10" rx="6" ry="11" transform="rotate(30 8 -10)" fill="#40a98a" stroke="${INK}" stroke-width="1.3"/>`
		+ `<ellipse cx="-13" cy="-3" rx="5" ry="9" transform="rotate(-58 -13 -3)" fill="#83d0a8" stroke="${INK}" stroke-width="1.3"/>`
		+ `<ellipse cx="13" cy="-4" rx="5" ry="9" transform="rotate(58 13 -4)" fill="#72c89f" stroke="${INK}" stroke-width="1.3"/>`
		+ `<ellipse cx="0" cy="-15" rx="6" ry="12" fill="#88d5a5" stroke="${INK}" stroke-width="1.3"/></g>`
		+ `<path d="M-11 2 L11 2 L8 16 L-8 16 Z" fill="#2498d2" stroke="${INK}" stroke-width="1.5"/>`
		+ `<ellipse cy="2" rx="12" ry="3" fill="#a9e6f8" stroke="${INK}" stroke-width="1"/>`
		+ '<path d="M-8 7H8" stroke="#b9ecff" stroke-width="1.6"/></g>'
}

function desk(x: number, y: number): string {
	const X = px(x)
	const Y = px(y)
	let out = `<g class="vo-furniture"><rect x="${X + 2}" y="${Y + 9}" width="${2 * T - 4}" height="${T - 6}" rx="8" fill="#9dcbe0"/>`
	out += `<rect x="${X + 2}" y="${Y + 2}" width="${2 * T - 4}" height="${T - 6}" rx="8" fill="#ffffff" stroke="${INK}" stroke-width="1.5"/>`
	out += `<path d="M${X + 10} ${Y + 32}h60" stroke="#0082c9" stroke-width="3" stroke-linecap="round"/>`
	for (const offset of [20, 60]) {
		const cx = X + offset
		out += `<rect x="${cx - 12}" y="${Y - 10}" width="24" height="20" rx="4" fill="${INK}"/>`
		out += `<rect x="${cx - 9}" y="${Y - 7}" width="18" height="13" rx="2" fill="#a8e4f9"/>`
		out += connectionMark(cx, Y - 1, 0.1, '#0082c9')
		out += `<path d="M${cx} ${Y + 10}v4" stroke="${INK}" stroke-width="2"/>`
		out += `<rect x="${cx - 9}" y="${Y + 18}" width="18" height="9" rx="2" fill="#e7f5fc" stroke="#9bcce5" stroke-width="1"/>`
		out += `<ellipse cx="${cx}" cy="${Y + 54}" rx="11" ry="7" fill="#245f87" stroke="${INK}" stroke-width="1.4"/>`
		out += `<ellipse cx="${cx}" cy="${Y + 51}" rx="7" ry="3" fill="#69b9de"/>`
	}
	out += `<path d="M${X + 40} ${Y + 8}v21" stroke="#badbec" stroke-width="1.2"/>`
	out += `<circle cx="${X + 40}" cy="${Y + 18}" r="5" fill="#ffffff" stroke="${INK}" stroke-width="1"/>`
	out += `<path d="M${X + 40} ${Y + 16}q-7 -9 -8 -2 q5 3 8 2 q4 -11 8 -3 q-4 4 -8 3" fill="#55b99a" stroke="${INK}" stroke-width=".8"/>`
	return out + '</g>'
}

function wallArt(kind: string, x = px(18) + 6): string {
	const y = 8
	const frame = `<rect x="${x}" y="${y}" width="68" height="26" rx="5" fill="#ffffff" stroke="${INK}" stroke-width="2"/>`
	switch (kind) {
		case 'mountains':
			return frame + `<path d="M${x + 4} ${y + 22} L${x + 22} ${y + 6} L${x + 34} ${y + 16} L${x + 46} ${y + 8} L${x + 64} ${y + 22} Z" fill="#82c9e8"/><circle cx="${x + 54}" cy="${y + 8}" r="3.5" fill="#ffbf69"/>`
		case 'cat':
			return frame + `<circle cx="${x + 34}" cy="${y + 15}" r="8" fill="#a6d5ee"/><path d="M${x + 27} ${y + 10} l1 -6 l5 4 M${x + 41} ${y + 10} l-1 -6 l-5 4" fill="#a6d5ee" stroke="#a6d5ee" stroke-width="2"/><circle cx="${x + 31}" cy="${y + 14}" r="1.2" fill="${INK}"/><circle cx="${x + 37}" cy="${y + 14}" r="1.2" fill="${INK}"/>`
		case 'abstract':
			return frame + connectionMark(x + 34, y + 13, 0.7, '#0082c9')
	}
	return ''
}

function lights(from = 1, to = 31, count = 16): string {
	let out = `<path d="M${px(from)} 32H${px(to)}" fill="none" stroke="#7dbddc" stroke-width="2"/>`
	for (let i = 0; i < count; i++) {
		const x = px(from) + 20 + i * 76
		out += `<circle class="vo-bulb" cx="${x}" cy="32" r="3.8" fill="${i % 3 === 0 ? '#ffce7b' : '#94e2f4'}"/>`
	}
	return out
}

/** A window pane in the top wall, starting at cell wx. */
function windowPane(wx: number): string {
	return `<rect x="${px(wx)}" y="5" width="${px(1.6)}" height="25" rx="4" fill="#a9e2f7" stroke="${INK}" stroke-width="2"/>`
		+ `<path d="M${px(wx) + 7} 8l10 0 -10 18" fill="#ffffff99"/>`
		+ `<line x1="${px(wx + 0.8)}" y1="5" x2="${px(wx + 0.8)}" y2="30" stroke="${INK}" stroke-width="1.5"/>`
}

/** Daylight falling from a window onto the floor. */
function beam(wx: number, length = 160): string {
	const x = px(wx)
	return `<path d="M${x - 4} 40h${px(1.6) + 8}l46 ${length}H${x - 50}Z" fill="#fff" opacity=".14"/>`
}

/** The shared record player on a low cabinet; the record spins while music plays. */
function musicPlayer(x: number, y: number): string {
	const X = px(x)
	const Y = px(y)
	return `<g class="vo-player"><rect x="${X + 3}" y="${Y + 17}" width="${T - 6}" height="${T - 14}" rx="5" fill="#16435f30"/>`
		+ `<rect x="${X + 3}" y="${Y + 14}" width="${T - 6}" height="${T - 16}" rx="5" fill="#dca878" stroke="${INK}" stroke-width="1.5"/>`
		+ `<circle cx="${X + 12}" cy="${Y + 31}" r="4" fill="#865f4b"/><circle cx="${X + 28}" cy="${Y + 31}" r="4" fill="#865f4b"/>`
		+ `<rect x="${X + 5}" y="${Y + 12}" width="${T - 10}" height="10" rx="3" fill="#ffffff" stroke="${INK}" stroke-width="1.3"/>`
		+ `<g class="vo-record"><ellipse cx="${X + 17}" cy="${Y + 17}" rx="9" ry="4" fill="${INK}"/><ellipse cx="${X + 17}" cy="${Y + 17}" rx="5.5" ry="2.4" fill="none" stroke="#3b6f92" stroke-width=".8"/><ellipse cx="${X + 17}" cy="${Y + 17}" rx="2.4" ry="1.1" fill="#ffbf69"/></g>`
		+ `<path d="M${X + 31} ${Y + 13}l-4 5" stroke="${INK}" stroke-width="1.6" stroke-linecap="round"/><circle cx="${X + 31}" cy="${Y + 13}" r="1.8" fill="#0082c9"/></g>`
}

/** Where a layout puts its seasonal decorations, in pixels. */
interface SeasonSpots {
	/** Left edges of the window panes, in cells. */
	windows: number[]
	/** On the coffee counter. */
	counter: [number, number]
	/** On the floor, next to the door. */
	door: [number, number]
	/** A free corner of the common room. */
	corner: [number, number]
}

function pumpkin(x: number, y: number, s = 1): string {
	return `<g transform="translate(${x} ${y}) scale(${s})"><ellipse cy="9" rx="13" ry="4" fill="#16435f30"/>`
		+ `<ellipse cx="-6" rx="7" ry="8" fill="#ef8a3c" stroke="${INK}" stroke-width="1.2"/><ellipse cx="6" rx="7" ry="8" fill="#ef8a3c" stroke="${INK}" stroke-width="1.2"/>`
		+ `<ellipse rx="6" ry="8.5" fill="#f6a04d" stroke="${INK}" stroke-width="1.2"/>`
		+ '<path d="M0 -8q1 -5 4 -6" fill="none" stroke="#3f7d4d" stroke-width="2.2" stroke-linecap="round"/></g>'
}

function leaf(x: number, y: number, angle: number, color: string): string {
	return `<g transform="translate(${x} ${y}) rotate(${angle})"><path d="M0 -6q6 3 0 12q-6 -9 0 -12z" fill="${color}" stroke="${INK}" stroke-width=".7"/><path d="M0 -5v11" stroke="${INK}" stroke-width=".5"/></g>`
}

function pineTree(x: number, y: number, s = 1.3): string {
	let out = `<g transform="translate(${x} ${y}) scale(${s})"><ellipse cy="18" rx="16" ry="4" fill="#16435f30"/><rect x="-4" y="9" width="8" height="9" rx="2" fill="#865f4b"/>`
	out += `<path d="M0 -26L13 -6H-13Z M0 -16L16 10H-16Z" fill="#2f9a73" stroke="${INK}" stroke-width="1.3" stroke-linejoin="round"/>`
	for (const [bx, by, c] of [[-6, -2, '#ffce7b'], [5, -8, '#efa3b8'], [8, 5, '#94e2f4'], [-9, 6, '#efa3b8'], [1, 2, '#ffce7b']] as const) {
		out += `<circle class="vo-bulb" cx="${bx}" cy="${by}" r="2.4" fill="${c}"/>`
	}
	return out + `<path d="M0 -31l1.6 3.4 3.7.5-2.7 2.6.6 3.7L0 -22.6l-3.3 1.7.6-3.7-2.7-2.6 3.7-.5Z" fill="#ffbf69" stroke="${INK}" stroke-width=".8"/></g>`
}

function lantern(x: number, y: number, s = 1): string {
	return `<g transform="translate(${x} ${y}) scale(${s})"><path d="M0 -8v-6" stroke="${INK}" stroke-width="1.2"/>`
		+ '<rect x="-5" y="-9" width="10" height="3" rx="1" fill="#ffbf69"/>'
		+ `<ellipse class="vo-bulb" rx="8" ry="7" fill="#e0565b" stroke="${INK}" stroke-width="1.2"/>`
		+ '<path d="M-3 -6.5q-2 6.5 0 13 M3 -6.5q2 6.5 0 13" fill="none" stroke="#ffbf69" stroke-width=".8"/>'
		+ '<rect x="-5" y="6" width="10" height="3" rx="1" fill="#ffbf69"/><path d="M0 9v6" stroke="#ffbf69" stroke-width="1.5"/></g>'
}

/** A branch in a vase, with blossoms: yellow mai or pink peach. */
function blossomBranch(x: number, y: number, color: string, s = 1): string {
	let out = `<g transform="translate(${x} ${y}) scale(${s})"><path d="M-6 0h12l-2 12h-8z" fill="#2498d2" stroke="${INK}" stroke-width="1.2"/>`
	out += '<path d="M0 0q-2 -10 -9 -16 M0 0q1 -12 8 -19 M0 -8q5 -3 10 -3" fill="none" stroke="#865f4b" stroke-width="1.6" stroke-linecap="round"/>'
	for (const [bx, by] of [[-9, -16], [-6, -11], [8, -19], [5, -14], [10, -11], [2, -7], [-3, -18]]) {
		out += `<circle cx="${bx}" cy="${by}" r="2.6" fill="${color}" stroke="${INK}" stroke-width=".5"/><circle cx="${bx}" cy="${by}" r=".9" fill="#f6a04d"/>`
	}
	return out + '</g>'
}

/** Seasonal decorations; lanterns and tree lights glow gently unless motion is reduced. */
export function seasonArt(kind: string, spots: SeasonSpots): string {
	const [cx, cy] = spots.corner
	const [dx, dy] = spots.door
	const [kx, ky] = spots.counter
	if (!['autumn', 'winter', 'lunar'].includes(kind)) {
		return ''
	}
	let out = `<g class="vo-season" data-season="${kind}">`
	switch (kind) {
		case 'autumn':
			out += pumpkin(dx, dy) + pumpkin(dx + 22, dy + 4, 0.75) + pumpkin(kx, ky, 0.55) + pumpkin(cx, cy, 0.9)
			for (const [i, [lx, ly]] of [[-26, 8], [-14, 14], [16, 12], [24, 2], [-20, -4]].entries()) {
				out += leaf(cx + lx, cy + ly, i * 67, ['#ef8a3c', '#e0565b', '#f1d174'][i % 3])
			}
			for (const wx of spots.windows) {
				out += leaf(px(wx) + 8, 26, 30, '#ef8a3c')
			}
			break
		case 'winter':
			for (const wx of spots.windows) {
				out += `<path d="M${px(wx) + 2} 30v-4q${px(0.4)} -5 ${px(0.8) - 2} 0q${px(0.4)} -6 ${px(0.8) - 2} 0v4z" fill="#ffffff" stroke="#c9e5f3" stroke-width="1"/>`
				for (const [fx, fy] of [[10, 10], [34, 16], [52, 9]]) {
					out += `<circle cx="${px(wx) + fx}" cy="${fy}" r="1.6" fill="#ffffff"/>`
				}
			}
			out += pineTree(cx, cy - 10)
			out += `<rect x="${cx + 12}" y="${cy + 4}" width="12" height="10" rx="2" fill="#e0565b" stroke="${INK}" stroke-width="1"/><path d="M${cx + 18} ${cy + 4}v10 M${cx + 12} ${cy + 9}h12" stroke="#ffbf69" stroke-width="1.6"/>`
			break
		case 'lunar':
			for (const wx of spots.windows) {
				out += lantern(px(wx + 1.6) + 9, 20, 0.85)
			}
			out += lantern(dx - 4, dy - 30) + lantern(dx + 30, dy - 30)
			out += blossomBranch(kx, ky + 2, '#f1d174', 0.8)
			out += `<g transform="translate(${cx} ${cy})"><ellipse cy="14" rx="14" ry="4" fill="#16435f30"/></g>` + blossomBranch(cx, cy + 2, '#f4b6c8', 1.5)
			break
	}
	return out + '</g>'
}

const STARTER_WINDOWS = [2.3, 7.3, 24, 27.2]
const COMPACT_WINDOWS = [1.4, 4.3, 15.3, 18.4]

/** The 32 × 20 starter office. */
function drawStarter(layout: Layout, decor: Record<string, string>): string {
	const W = layout.width
	const H = layout.height
	const floor = FLOORS[decor.floor] ?? FLOORS.oak
	const rug = RUGS[decor.rug] ?? null
	let s = ''

	// Floors
	s += tiles(1, 1, 10, 8, '#fbf7f1', '#f1e9df')
	s += tiles(1, 9, 10, 10, '#edf6fc', '#e1eff8')
	s += planks(11, 1, 11, 18, floor)
	s += carpet(22, 1, 9, 18)
	s += '<path d="M93 40h64l46 160H47Z M285 40h64l47 153H239Z M970 40h73l54 210H918Z M1100 40h72l58 210h-183Z" fill="#fff" opacity=".14"/>'
	s += `<circle cx="${px(8)}" cy="${px(4) + 23}" r="94" fill="#16435f20"/>`
	s += `<circle cx="${px(8)}" cy="${px(4) + 20}" r="91" fill="#d9eef9"/><circle cx="${px(8)}" cy="${px(4) + 20}" r="79" fill="#c6e5f5"/>`
	s += connectionMark(px(5) + 20, px(14) + 20, 1.4, '#c8e1f1')
	for (const y of [2, 7, 15]) {
		s += `<rect x="${px(23) + 5}" y="${px(y) + 10}" width="${px(8) - 10}" height="${px(3) - 12}" rx="22" fill="#a3d0e8"/>`
		s += `<rect x="${px(23) + 5}" y="${px(y) + 6}" width="${px(8) - 10}" height="${px(3) - 12}" rx="22" fill="#edf7fc" stroke="#c9e5f3" stroke-width="2"/>`
	}

	// Rug and welcome mat
	if (rug) {
		s += cloudRug(rug)
		s += connectionMark(px(16) + 20, px(10) + 40, 3.6, '#ffffffaa')
	}
	s += `<rect x="${px(4) + 4}" y="${px(18) + 6}" width="${px(3) - 8}" height="${T - 10}" rx="7" fill="#0082c9"/>`
	s += connectionMark(px(5) + 20, px(18) + 20, 0.62)

	// Outer walls, windows and door
	s += wallBlock(0, 0, W, 1) + wallBlock(0, 0, 1, H) + wallBlock(W - 1, 0, 1, H) + wallBlock(0, H - 1, W, 1)
	for (const wx of STARTER_WINDOWS) {
		s += windowPane(wx)
	}
	s += `<rect x="${px(4)}" y="${px(H - 1)}" width="${px(3)}" height="${T}" fill="#063f68"/><rect x="${px(4) + 6}" y="${px(H - 1) + 4}" width="${px(3) - 12}" height="${T - 4}" fill="#126a9d"/>`

	// Partitions
	for (let y = 0; y < H; y++) {
		for (const x of [1, 2, 3, 8, 9, 10]) {
			if (y === 9 && layout.collision[y][x] === '#') {
				s += wallBlock(x, y, 1, 1)
			}
		}
		if (y > 0 && y < H - 1 && layout.collision[y][22] === '#') {
			s += wallBlock(22, y, 1, 1)
		}
	}

	if (decor.lights === 'warm') {
		s += lights()
	}
	s += wallArt(decor.wallArt)

	// Coffee corner: counter with machine, bookshelf, round table and stools
	s += coffeeCounter(5)
	s += `<circle cx="${px(1) + 16}" cy="${px(1) + 18}" r="5" fill="#ffbf69"/><rect x="${px(5) + 8}" y="${px(1) + 8}" width="16" height="14" rx="3" fill="#dceffa" stroke="${INK}" stroke-width="1"/>`
	s += `<rect x="${px(10) + 3}" y="${px(1) - 12}" width="${T - 6}" height="${T + 8}" rx="5" fill="#ffffff" stroke="${INK}" stroke-width="1.5"/>`
	for (const [i, c] of ['#0082c9', '#ffbf69', '#57bfa5', '#9893da'].entries()) {
		s += `<rect x="${px(10) + 7 + i * 7}" y="${px(1) - 6 + (i % 2) * 22}" width="5" height="16" fill="${c}"/>`
	}
	s += plant(px(0) + 18, px(7) + 10, 0.8)
	s += plant(px(10) + 20, px(0) + 26, 0.65)
	s += coffeeTable(8, 4)

	// Common room: sofa, low table, bean bags, shared plant, record player
	s += sofa(13, 5)
	s += `<rect x="${px(14) + 4}" y="${px(3) + 10}" width="${px(3) - 8}" height="${T - 12}" rx="7" fill="#16435f30"/>`
	s += `<rect x="${px(14) + 4}" y="${px(3) + 6}" width="${px(3) - 8}" height="${T - 12}" rx="7" fill="#e4b285" stroke="${INK}" stroke-width="1.5"/>`
	s += `<rect x="${px(15) + 8}" y="${px(3) + 12}" width="14" height="10" rx="2" fill="#ffffff" stroke="${INK}" stroke-width="1"/>`
	s += `<circle cx="${px(16) + 8}" cy="${px(3) + 20}" r="5" fill="#ffffff" stroke="${INK}" stroke-width="1"/>`
	s += plant(px(14) + 18, px(3) + 14, 0.45)
	s += beanBags([12, 20], 16)
	s += `<g class="vo-shared-plant">${plant(px(16) + 20, px(10) + 18, 1.35)}</g>`
	s += plant(px(22) + 20, px(2) + 16, 0.95)
	s += plant(px(22) + 20, px(15) + 20, 0.85)
	if (layout.player) {
		s += musicPlayer(...layout.player.cell)
	}

	// Focus desks and corner plants
	for (const [x, y] of [[24, 3], [28, 3], [24, 8], [28, 8], [24, 16], [28, 16]]) {
		s += desk(x, y)
	}
	s += plant(px(30) + 20, px(1) + 14, 0.9)
	s += plant(px(31) + 8, px(18) + 14, 0.8)

	// Entrance: coat rack and bench
	s += coatRack(0)
	s += `<rect x="${px(8) + 4}" y="${px(18) + 8}" width="${px(2) - 8}" height="${T - 16}" rx="5" fill="#ffffff" stroke="${INK}" stroke-width="1.5"/>`
	s += `<path d="M${px(8) + 13} ${px(18) + 16}h${px(2) - 26}" stroke="#0082c9" stroke-width="3"/>`
	s += shelf(12)
	s += plant(px(0) + 20, px(15) + 10, 0.65)

	return s + seasonArt(decor.season, {
		windows: STARTER_WINDOWS,
		counter: [px(2) + 20, px(1) + 16],
		door: [px(2) + 24, px(18) + 22],
		corner: [px(21) + 12, px(18) + 14],
	})
}

/** The 22 × 14 office for small teams. */
function drawCompact(layout: Layout, decor: Record<string, string>): string {
	const W = layout.width
	const H = layout.height
	const floor = FLOORS[decor.floor] ?? FLOORS.oak
	const rug = RUGS[decor.rug] ?? null
	let s = ''

	// Floors
	s += tiles(1, 1, 7, 6, '#fbf7f1', '#f1e9df')
	s += tiles(1, 7, 7, 6, '#edf6fc', '#e1eff8')
	s += planks(8, 1, 6, 12, floor)
	s += carpet(14, 1, 7, 12)
	for (const wx of COMPACT_WINDOWS) {
		s += beam(wx, wx < 8 ? 140 : 120)
	}
	s += `<circle cx="${px(5)}" cy="${px(4) + 23}" r="74" fill="#16435f20"/>`
	s += `<circle cx="${px(5)}" cy="${px(4) + 20}" r="71" fill="#d9eef9"/><circle cx="${px(5)}" cy="${px(4) + 20}" r="61" fill="#c6e5f5"/>`
	s += connectionMark(px(4), px(9) + 20, 1.1, '#c8e1f1')
	for (const y of [1, 5, 9]) {
		s += `<rect x="${px(15) + 5}" y="${px(y) + 10}" width="${px(6) - 10}" height="${px(3) - 12}" rx="22" fill="#a3d0e8"/>`
		s += `<rect x="${px(15) + 5}" y="${px(y) + 6}" width="${px(6) - 10}" height="${px(3) - 12}" rx="22" fill="#edf7fc" stroke="#c9e5f3" stroke-width="2"/>`
	}

	// Rug and welcome mat
	if (rug) {
		s += cloudRug(rug, `translate(${px(11) - 655 * 0.6} ${px(6) + 20 - 425 * 0.6}) scale(.6)`)
		s += connectionMark(px(11), px(6) + 30, 2.2, '#ffffffaa')
	}
	s += `<rect x="${px(3) + 4}" y="${px(12) + 6}" width="${px(3) - 8}" height="${T - 10}" rx="7" fill="#0082c9"/>`
	s += connectionMark(px(4) + 20, px(12) + 20, 0.62)

	// Outer walls, windows and door
	s += wallBlock(0, 0, W, 1) + wallBlock(0, 0, 1, H) + wallBlock(W - 1, 0, 1, H) + wallBlock(0, H - 1, W, 1)
	for (const wx of COMPACT_WINDOWS) {
		s += windowPane(wx)
	}
	s += `<rect x="${px(3)}" y="${px(H - 1)}" width="${px(3)}" height="${T}" fill="#063f68"/><rect x="${px(3) + 6}" y="${px(H - 1) + 4}" width="${px(3) - 12}" height="${T - 4}" fill="#126a9d"/>`

	// Partitions
	for (let y = 1; y < H - 1; y++) {
		for (const x of [1, 2, 6, 7]) {
			if (y === 7 && layout.collision[y][x] === '#') {
				s += wallBlock(x, y, 1, 1)
			}
		}
		if (layout.collision[y][14] === '#') {
			s += wallBlock(14, y, 1, 1)
		}
	}

	if (decor.lights === 'warm') {
		s += lights(1, 21, 11)
	}
	s += wallArt(decor.wallArt, px(9) + 6)

	// Coffee corner: counter with machine, round table and stools
	s += coffeeCounter(4)
	s += `<circle cx="${px(1) + 16}" cy="${px(1) + 18}" r="5" fill="#ffbf69"/><rect x="${px(4) + 8}" y="${px(1) + 8}" width="16" height="14" rx="3" fill="#dceffa" stroke="${INK}" stroke-width="1"/>`
	s += plant(px(0) + 18, px(6) + 10, 0.8)
	s += plant(px(7) + 20, px(1) + 18, 0.6)
	s += coffeeTable(5, 4)

	// Common room: record player, sofa, low table, bean bags, shared plant
	if (layout.player) {
		s += musicPlayer(...layout.player.cell)
	}
	s += sofa(9, 4)
	s += `<rect x="${px(10) + 4}" y="${px(3) + 10}" width="${px(2) - 8}" height="${T - 12}" rx="7" fill="#16435f30"/>`
	s += `<rect x="${px(10) + 4}" y="${px(3) + 6}" width="${px(2) - 8}" height="${T - 12}" rx="7" fill="#e4b285" stroke="${INK}" stroke-width="1.5"/>`
	s += `<rect x="${px(10) + 12}" y="${px(3) + 12}" width="14" height="10" rx="2" fill="#ffffff" stroke="${INK}" stroke-width="1"/>`
	s += `<circle cx="${px(11) + 16}" cy="${px(3) + 20}" r="5" fill="#ffffff" stroke="${INK}" stroke-width="1"/>`
	s += beanBags([9, 12], 11)
	s += `<g class="vo-shared-plant">${plant(px(11) + 20, px(8) + 18, 1.35)}</g>`
	s += plant(px(14) + 20, px(2) + 16, 0.95)
	s += plant(px(14) + 20, px(11) + 20, 0.85)

	// Focus desks and corner plants
	for (const y of [2, 6, 10]) {
		s += desk(17, y)
	}
	s += plant(px(20) + 20, px(1) + 14, 0.9)
	s += plant(px(21) + 8, px(12) + 14, 0.8)

	// Entrance: coat rack and bench
	s += coatRack(-6)
	s += `<rect x="${px(6) + 4}" y="${px(12) + 8}" width="${px(2) - 8}" height="${T - 16}" rx="5" fill="#ffffff" stroke="${INK}" stroke-width="1.5"/>`
	s += `<path d="M${px(6) + 13} ${px(12) + 16}h${px(2) - 26}" stroke="#0082c9" stroke-width="3"/>`
	s += shelf(8)
	s += plant(px(0) + 20, px(10) + 30, 0.65)

	return s + seasonArt(decor.season, {
		windows: COMPACT_WINDOWS,
		counter: [px(2) + 12, px(1) + 16],
		door: [px(1) + 26, px(12) + 22],
		corner: [px(13) + 18, px(12) + 14],
	})
}

/** The cloud rug of the starter common room; other layouts move and scale it. */
function cloudRug(rug: [string, string], transform?: string): string {
	const cloud = 'M530 515 C490 509 480 466 502 437 C485 399 506 357 546 356 C561 318 609 303 644 324 C676 292 728 301 751 338 C797 338 822 377 808 414 C835 445 818 497 779 509 C748 541 695 549 660 531 C620 553 559 548 530 515 Z'
	const art = `<path d="${cloud}" fill="${rug[1]}" style="filter:drop-shadow(0 5px 3px #16435f33)"/>`
		+ `<path d="${cloud}" fill="${rug[0]}" transform="translate(660 425) scale(.94) translate(-660 -425)"/>`
	return transform ? `<g transform="${transform}">${art}</g>` : art
}

/** The counter along the top wall, from cell 1, with the coffee machine at cell 3. */
function coffeeCounter(width: number): string {
	let s = `<rect x="${px(1) + 2}" y="${px(1) + 6}" width="${px(width) - 4}" height="${T - 2}" rx="8" fill="#8cc4df"/>`
	s += `<rect x="${px(1) + 2}" y="${px(1) + 2}" width="${px(width) - 4}" height="${T - 6}" rx="8" fill="#ffffff" stroke="${INK}" stroke-width="1.5"/>`
	s += `<path d="M${px(1) + 12} ${px(1) + 30}h${px(width) - 24}" stroke="#0082c9" stroke-width="3" stroke-linecap="round"/>`
	s += `<g class="vo-coffee-machine"><rect x="${px(3) + 6}" y="${px(1) - 10}" width="28" height="36" rx="6" fill="${INK}"/>`
		+ `<rect x="${px(3) + 11}" y="${px(1) - 5}" width="18" height="9" rx="2" fill="#a8e9f9"/>`
		+ connectionMark(px(3) + 20, px(1), 0.17, '#0082c9')
		+ `<rect x="${px(3) + 14}" y="${px(1) + 18}" width="12" height="9" rx="2" fill="#ffffff"/></g>`
	return s
}

/** A round table spanning the two cells left and right of cell line x, with four stools. */
function coffeeTable(x: number, y: number): string {
	let s = `<ellipse cx="${px(x)}" cy="${px(y) + 25}" rx="43" ry="21" fill="#16435f30"/>`
	s += `<ellipse cx="${px(x)}" cy="${px(y) + 18}" rx="43" ry="20" fill="#dca878" stroke="${INK}" stroke-width="1.5"/>`
	s += `<ellipse cx="${px(x)}" cy="${px(y) + 15}" rx="37" ry="14" fill="#efc59d"/>`
	s += plant(px(x), px(y) + 10, 0.5)
	s += `<circle cx="${px(x) - 17}" cy="${px(y) + 15}" r="5" fill="#fff7e9" stroke="${INK}" stroke-width="1"/>`
	s += `<path d="M${px(x) - 12} ${px(y) + 14}q5 -1 5 3" fill="none" stroke="${INK}" stroke-width="1.2"/>`
	s += `<circle cx="${px(x) + 16}" cy="${px(y) + 21}" r="5" fill="#fff7e9" stroke="${INK}" stroke-width="1"/>`
	s += `<path d="M${px(x) + 21} ${px(y) + 20}q5 -1 5 3" fill="none" stroke="${INK}" stroke-width="1.2"/>`
	for (const [sx, sy] of [[x - 1, y - 1], [x + 1, y], [x, y + 1], [x - 2, y]]) {
		s += `<circle cx="${px(sx) + 20}" cy="${px(sy) + 24}" r="12" fill="#16435f30"/>`
		s += `<circle cx="${px(sx) + 20}" cy="${px(sy) + 21}" r="11" fill="#246c9a" stroke="${INK}" stroke-width="1.3"/>`
		s += `<circle cx="${px(sx) + 17}" cy="${px(sy) + 18}" r="3" fill="#77c5ea"/>`
	}
	return s
}

/** A sofa along the top wall, from cell x, width cells wide. */
function sofa(x: number, width: number): string {
	let s = `<rect x="${px(x)}" y="${px(1) + 2}" width="${px(width)}" height="${T + 2}" rx="14" fill="#16435f3d"/>`
	s += `<rect x="${px(x)}" y="${px(1) - 4}" width="${px(width)}" height="${T + 2}" rx="13" fill="#188bcc" stroke="${INK}" stroke-width="1.5"/>`
	s += `<rect x="${px(x) + 8}" y="${px(1) + 12}" width="${px(width) - 16}" height="${T - 16}" rx="8" fill="#70c6eb"/>`
	s += `<rect x="${px(x) + 18}" y="${px(1) + 6}" width="34" height="20" rx="7" fill="#dff6ff" transform="rotate(-8 ${px(x) + 35} ${px(1) + 16})"/>`
	s += `<rect x="${px(x + width - 1) - 16}" y="${px(1) + 6}" width="34" height="20" rx="7" fill="#0b6eac" transform="rotate(8 ${px(x + width - 1) + 1} ${px(1) + 16})"/>`
	return s
}

function beanBags(xs: number[], y: number): string {
	let s = ''
	for (const [i, x] of xs.entries()) {
		const c = i % 2 === 0 ? '#76d0b8' : '#a29bdf'
		s += `<ellipse cx="${px(x) + 20}" cy="${px(y) + 27}" rx="21" ry="17" fill="#16435f30"/>`
		s += `<ellipse cx="${px(x) + 20}" cy="${px(y) + 22}" rx="21" ry="17" fill="${c}" stroke="${INK}" stroke-width="1.5"/>`
		s += `<ellipse cx="${px(x) + 16}" cy="${px(y) + 16}" rx="10" ry="6" fill="#ffffff66"/>`
	}
	return s
}

/** The coat rack by the door, drawn for the starter office and moved up by rows. */
function coatRack(rows: number): string {
	const dy = px(rows)
	let s = `<path d="M${px(1) + 21} ${px(18) + dy}v-36a28 28 0 0 1 56 0v36" fill="none" stroke="#0082c9" stroke-width="5"/>`
	s += connectionMark(px(1) + 49, px(17) - 16 + dy, 0.45, '#0082c9')
	s += `<path d="M${px(1) + 20} ${px(18) + 4 + dy}v12" stroke="${INK}" stroke-width="3"/><circle cx="${px(1) + 20}" cy="${px(18) + 2 + dy}" r="4" fill="${INK}"/>`
	return s
}

/** A bookshelf on the left wall, from row y. */
function shelf(y: number): string {
	let s = `<rect x="${px(0) + 6}" y="${px(y)}" width="27" height="72" rx="5" fill="#dca878" stroke="${INK}" stroke-width="1.4"/>`
	s += `<path d="M${px(0) + 9} ${px(y + 1) + 2}h21 M${px(0) + 9} ${px(y + 2) + 14}h21" stroke="#865f4b" stroke-width="2"/>`
	s += `<rect x="${px(0) + 11}" y="${px(y) + 8}" width="5" height="24" fill="#0082c9"/><rect x="${px(0) + 18}" y="${px(y) + 11}" width="6" height="21" fill="#a29bdf"/>`
	s += `<rect x="${px(0) + 13}" y="${px(y + 1) + 10}" width="12" height="16" rx="2" fill="#a6d8ed"/>`
	return s
}

const DRAW: Record<string, (layout: Layout, decor: Record<string, string>) => string> = {
	'starter-office-v1': drawStarter,
	'compact-office-v1': drawCompact,
}

/** The rendered preview of a layout in img/, for cards and the office door. */
export function previewFile(layoutId: string): string {
	return layoutId === 'starter-office-v1' ? 'office-preview.webp' : `office-preview-${layoutId}.webp`
}

export function mapSvg(layoutId: string, decor: Record<string, string>): string {
	const layout = getLayout(layoutId)
	const draw = DRAW[layoutId] ?? drawStarter
	return `<svg class="vo-map" viewBox="0 0 ${px(layout.width)} ${px(layout.height)}" width="${px(layout.width)}" height="${px(layout.height)}" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">`
		+ draw(layout, decor) + '</svg>'
}
