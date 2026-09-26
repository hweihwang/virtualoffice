/**
 * SPDX-FileCopyrightText: 2026 Hoang Pham
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
import type { Layout } from '../../shared/catalog.ts'

/**
 * Background artwork for the starter office, drawn from the layout so the
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

function wallArt(kind: string): string {
	const x = px(18) + 6
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

function lights(): string {
	let out = `<path d="M${px(1)} 32H${px(31)}" fill="none" stroke="#7dbddc" stroke-width="2"/>`
	for (let i = 0; i < 16; i++) {
		const x = px(1) + 20 + i * 76
		out += `<circle class="vo-bulb" cx="${x}" cy="32" r="3.8" fill="${i % 3 === 0 ? '#ffce7b' : '#94e2f4'}"/>`
	}
	return out
}

export function mapSvg(layout: Layout, decor: Record<string, string>): string {
	const W = layout.width
	const H = layout.height
	const floor = FLOORS[decor.floor] ?? FLOORS.oak
	const rug = RUGS[decor.rug] ?? null
	let s = `<svg class="vo-map" viewBox="0 0 ${px(W)} ${px(H)}" width="${px(W)}" height="${px(H)}" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">`

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
		const cloud = 'M530 515 C490 509 480 466 502 437 C485 399 506 357 546 356 C561 318 609 303 644 324 C676 292 728 301 751 338 C797 338 822 377 808 414 C835 445 818 497 779 509 C748 541 695 549 660 531 C620 553 559 548 530 515 Z'
		s += `<path d="${cloud}" fill="${rug[1]}" style="filter:drop-shadow(0 5px 3px #16435f33)"/>`
		s += `<path d="${cloud}" fill="${rug[0]}" transform="translate(660 425) scale(.94) translate(-660 -425)"/>`
		s += connectionMark(px(16) + 20, px(10) + 40, 3.6, '#ffffffaa')
	}
	s += `<rect x="${px(4) + 4}" y="${px(18) + 6}" width="${px(3) - 8}" height="${T - 10}" rx="7" fill="#0082c9"/>`
	s += connectionMark(px(5) + 20, px(18) + 20, 0.62)

	// Outer walls, windows and door
	s += wallBlock(0, 0, W, 1) + wallBlock(0, 0, 1, H) + wallBlock(W - 1, 0, 1, H) + wallBlock(0, H - 1, W, 1)
	for (const wx of [2.3, 7.3, 24, 27.2]) {
		s += `<rect x="${px(wx)}" y="5" width="${px(1.6)}" height="25" rx="4" fill="#a9e2f7" stroke="${INK}" stroke-width="2"/>`
		s += `<path d="M${px(wx) + 7} 8l10 0 -10 18" fill="#ffffff99"/>`
		s += `<line x1="${px(wx + 0.8)}" y1="5" x2="${px(wx + 0.8)}" y2="30" stroke="${INK}" stroke-width="1.5"/>`
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
	s += `<rect x="${px(1) + 2}" y="${px(1) + 6}" width="${px(5) - 4}" height="${T - 2}" rx="8" fill="#8cc4df"/>`
	s += `<rect x="${px(1) + 2}" y="${px(1) + 2}" width="${px(5) - 4}" height="${T - 6}" rx="8" fill="#ffffff" stroke="${INK}" stroke-width="1.5"/>`
	s += `<path d="M${px(1) + 12} ${px(1) + 30}h${px(5) - 24}" stroke="#0082c9" stroke-width="3" stroke-linecap="round"/>`
	s += `<g class="vo-coffee-machine"><rect x="${px(3) + 6}" y="${px(1) - 10}" width="28" height="36" rx="6" fill="${INK}"/>`
		+ `<rect x="${px(3) + 11}" y="${px(1) - 5}" width="18" height="9" rx="2" fill="#a8e9f9"/>`
		+ connectionMark(px(3) + 20, px(1), 0.17, '#0082c9')
		+ `<rect x="${px(3) + 14}" y="${px(1) + 18}" width="12" height="9" rx="2" fill="#ffffff"/></g>`
	s += `<circle cx="${px(1) + 16}" cy="${px(1) + 18}" r="5" fill="#ffbf69"/><rect x="${px(5) + 8}" y="${px(1) + 8}" width="16" height="14" rx="3" fill="#dceffa" stroke="${INK}" stroke-width="1"/>`
	s += `<rect x="${px(10) + 3}" y="${px(1) - 12}" width="${T - 6}" height="${T + 8}" rx="5" fill="#ffffff" stroke="${INK}" stroke-width="1.5"/>`
	for (const [i, c] of ['#0082c9', '#ffbf69', '#57bfa5', '#9893da'].entries()) {
		s += `<rect x="${px(10) + 7 + i * 7}" y="${px(1) - 6 + (i % 2) * 22}" width="5" height="16" fill="${c}"/>`
	}
	s += plant(px(0) + 18, px(7) + 10, 0.8)
	s += plant(px(10) + 20, px(0) + 26, 0.65)
	s += `<ellipse cx="${px(8)}" cy="${px(4) + 25}" rx="43" ry="21" fill="#16435f30"/>`
	s += `<ellipse cx="${px(8)}" cy="${px(4) + 18}" rx="43" ry="20" fill="#dca878" stroke="${INK}" stroke-width="1.5"/>`
	s += `<ellipse cx="${px(8)}" cy="${px(4) + 15}" rx="37" ry="14" fill="#efc59d"/>`
	s += plant(px(8), px(4) + 10, 0.5)
	s += `<circle cx="${px(8) - 17}" cy="${px(4) + 15}" r="5" fill="#fff7e9" stroke="${INK}" stroke-width="1"/>`
	s += `<path d="M${px(8) - 12} ${px(4) + 14}q5 -1 5 3" fill="none" stroke="${INK}" stroke-width="1.2"/>`
	s += `<circle cx="${px(8) + 16}" cy="${px(4) + 21}" r="5" fill="#fff7e9" stroke="${INK}" stroke-width="1"/>`
	s += `<path d="M${px(8) + 21} ${px(4) + 20}q5 -1 5 3" fill="none" stroke="${INK}" stroke-width="1.2"/>`
	for (const [x, y] of [[7, 3], [9, 4], [8, 5], [6, 4]]) {
		s += `<circle cx="${px(x) + 20}" cy="${px(y) + 24}" r="12" fill="#16435f30"/>`
		s += `<circle cx="${px(x) + 20}" cy="${px(y) + 21}" r="11" fill="#246c9a" stroke="${INK}" stroke-width="1.3"/>`
		s += `<circle cx="${px(x) + 17}" cy="${px(y) + 18}" r="3" fill="#77c5ea"/>`
	}

	// Common room: sofa, low table, bean bags, shared plant
	s += `<rect x="${px(13)}" y="${px(1) + 2}" width="${px(5)}" height="${T + 2}" rx="14" fill="#16435f3d"/>`
	s += `<rect x="${px(13)}" y="${px(1) - 4}" width="${px(5)}" height="${T + 2}" rx="13" fill="#188bcc" stroke="${INK}" stroke-width="1.5"/>`
	s += `<rect x="${px(13) + 8}" y="${px(1) + 12}" width="${px(5) - 16}" height="${T - 16}" rx="8" fill="#70c6eb"/>`
	s += `<rect x="${px(13) + 18}" y="${px(1) + 6}" width="34" height="20" rx="7" fill="#dff6ff" transform="rotate(-8 ${px(13) + 35} ${px(1) + 16})"/>`
	s += `<rect x="${px(17) - 16}" y="${px(1) + 6}" width="34" height="20" rx="7" fill="#0b6eac" transform="rotate(8 ${px(17) + 1} ${px(1) + 16})"/>`
	s += `<rect x="${px(14) + 4}" y="${px(3) + 10}" width="${px(3) - 8}" height="${T - 12}" rx="7" fill="#16435f30"/>`
	s += `<rect x="${px(14) + 4}" y="${px(3) + 6}" width="${px(3) - 8}" height="${T - 12}" rx="7" fill="#e4b285" stroke="${INK}" stroke-width="1.5"/>`
	s += `<rect x="${px(15) + 8}" y="${px(3) + 12}" width="14" height="10" rx="2" fill="#ffffff" stroke="${INK}" stroke-width="1"/>`
	s += `<circle cx="${px(16) + 8}" cy="${px(3) + 20}" r="5" fill="#ffffff" stroke="${INK}" stroke-width="1"/>`
	s += plant(px(14) + 18, px(3) + 14, 0.45)
	for (const [x, c] of [[12, '#76d0b8'], [20, '#a29bdf']] as const) {
		s += `<ellipse cx="${px(x) + 20}" cy="${px(16) + 27}" rx="21" ry="17" fill="#16435f30"/>`
		s += `<ellipse cx="${px(x) + 20}" cy="${px(16) + 22}" rx="21" ry="17" fill="${c}" stroke="${INK}" stroke-width="1.5"/>`
		s += `<ellipse cx="${px(x) + 16}" cy="${px(16) + 16}" rx="10" ry="6" fill="#ffffff66"/>`
	}
	s += `<g class="vo-shared-plant">${plant(px(16) + 20, px(10) + 18, 1.35)}</g>`
	s += plant(px(22) + 20, px(2) + 16, 0.95)
	s += plant(px(22) + 20, px(15) + 20, 0.85)

	// Focus desks and corner plants
	for (const [x, y] of [[24, 3], [28, 3], [24, 8], [28, 8], [24, 16], [28, 16]]) {
		s += desk(x, y)
	}
	s += plant(px(30) + 20, px(1) + 14, 0.9)
	s += plant(px(31) + 8, px(18) + 14, 0.8)

	// Entrance: coat rack and bench
	s += `<path d="M${px(1) + 21} ${px(18)}v-36a28 28 0 0 1 56 0v36" fill="none" stroke="#0082c9" stroke-width="5"/>`
	s += connectionMark(px(1) + 49, px(17) - 16, 0.45, '#0082c9')
	s += `<path d="M${px(1) + 20} ${px(18) + 4}v12" stroke="${INK}" stroke-width="3"/><circle cx="${px(1) + 20}" cy="${px(18) + 2}" r="4" fill="${INK}"/>`
	s += `<rect x="${px(8) + 4}" y="${px(18) + 8}" width="${px(2) - 8}" height="${T - 16}" rx="5" fill="#ffffff" stroke="${INK}" stroke-width="1.5"/>`
	s += `<path d="M${px(8) + 13} ${px(18) + 16}h${px(2) - 26}" stroke="#0082c9" stroke-width="3"/>`
	s += `<rect x="${px(0) + 6}" y="${px(12)}" width="27" height="72" rx="5" fill="#dca878" stroke="${INK}" stroke-width="1.4"/>`
	s += `<path d="M${px(0) + 9} ${px(13) + 2}h21 M${px(0) + 9} ${px(14) + 14}h21" stroke="#865f4b" stroke-width="2"/>`
	s += `<rect x="${px(0) + 11}" y="${px(12) + 8}" width="5" height="24" fill="#0082c9"/><rect x="${px(0) + 18}" y="${px(12) + 11}" width="6" height="21" fill="#a29bdf"/>`
	s += `<rect x="${px(0) + 13}" y="${px(13) + 10}" width="12" height="16" rx="2" fill="#a6d8ed"/>`
	s += plant(px(0) + 20, px(15) + 10, 0.65)

	return s + '</svg>'
}
