/**
 * SPDX-FileCopyrightText: 2026 Hoang Pham
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
import type { Cell, Layout } from '../../shared/catalog.ts'

import { describe, expect, it } from 'vitest'
import { catalog, getLayout, isWalkable, zoneAt } from '../../shared/catalog.ts'
import { findPath } from '../../shared/movement.ts'
import { mapSvg } from '../../src/scene/map.ts'
import { creatureSvg } from '../../src/scene/sprites.ts'

const layouts = Object.keys(catalog.layouts)

describe('office artwork', () => {
	it('renders every catalog appearance in each direction', () => {
		for (const creature of catalog.creatures) {
			for (const palette of catalog.palettes) {
				for (const accessory of catalog.accessories) {
					for (const facing of ['south', 'north', 'east'] as const) {
						const svg = creatureSvg({ creature, palette: palette.id, accessory }, facing)
						expect(svg).toContain('viewBox="0 0 48 56"')
						expect(svg).toContain(palette.body)
						expect(svg).not.toContain('undefined')
						expect(svg).toContain('aria-hidden="true"')
					}
				}
			}
		}
	})

	it.each(layouts)('draws %s with every decor option, seasons included', (layoutId) => {
		const layout = getLayout(layoutId)
		const defaults = Object.fromEntries(Object.entries(catalog.decor).map(([slot, d]) => [slot, d.default]))
		for (const [slot, definition] of Object.entries(catalog.decor)) {
			for (const option of definition.options) {
				const svg = mapSvg(layoutId, { ...defaults, [slot]: option })
				expect(svg).toContain(`viewBox="0 0 ${layout.width * layout.tileSize} ${layout.height * layout.tileSize}"`)
				expect(svg).toContain('#0082c9')
				expect(svg).toContain('class="vo-player"')
				expect(svg).not.toContain('undefined')
				expect(svg).not.toContain('NaN')
				if (slot === 'season') {
					expect(svg.includes(`data-season="${option}"`)).toBe(option !== 'none')
				}
			}
		}
	})
})

/** Free cells within a radius of a spot on a blocked piece of furniture. */
function standingSpots(layout: Layout, center: Cell, radius: number): Cell[] {
	const [x, y] = center
	const spots: Cell[] = []
	for (let dy = -2; dy <= 2; dy++) {
		for (let dx = -2; dx <= 2; dx++) {
			if ((dx || dy) && Math.hypot(dx, dy) <= radius && isWalkable(layout, [x + dx, y + dy])) {
				spots.push([x + dx, y + dy])
			}
		}
	}
	return spots
}

describe.each(layouts)('catalog layout %s', (layoutId) => {
	const layout = getLayout(layoutId)
	const start = layout.spawn[0]
	const reachable = (cell: Cell) => findPath(layout, start, cell) !== null

	it('has matching sizes, zones that cover the floor and a capacity', () => {
		expect(layout.collision).toHaveLength(layout.height)
		expect(layout.collision.every((row) => row.length === layout.width && /^[#.]+$/.test(row))).toBe(true)
		expect(layout.capacity).toBeGreaterThan(1)
		expect(layout.capacity).toBeLessThanOrEqual(catalog.limits.roomCapacity)
		expect(layout.zones.map((z) => z.id).sort()).toEqual(['coffee', 'common', 'entrance', 'focus'])
		expect(layout.zones.find((z) => z.id === 'focus')?.quiet).toBe(true)
		for (let y = 0; y < layout.height; y++) {
			for (let x = 0; x < layout.width; x++) {
				if (isWalkable(layout, [x, y])) {
					expect(zoneAt(layout, [x, y]), `${x}:${y}`).not.toBeNull()
					expect(reachable([x, y]), `${x}:${y} reachable`).toBe(true)
				}
			}
		}
	})

	it('puts spawn cells, anchors and desks on reachable floor in their zones', () => {
		for (const cell of layout.spawn) {
			expect(isWalkable(layout, cell), `spawn ${cell}`).toBe(true)
			expect(zoneAt(layout, cell)).toBe('entrance')
		}
		for (const [zone, cell] of Object.entries(layout.zoneAnchors)) {
			expect(isWalkable(layout, cell), `anchor ${zone}`).toBe(true)
			expect(zoneAt(layout, cell)).toBe(zone)
		}
		for (const desk of layout.desks ?? []) {
			expect(isWalkable(layout, desk.cell), desk.id).toBe(true)
			expect(zoneAt(layout, desk.cell)).toBe('focus')
		}
		expect(new Set(layout.desks?.map((d) => d.id)).size).toBe(layout.desks?.length)
		// Team resources hang on the wall above a spot you can walk to.
		for (const fixture of layout.fixtures ?? []) {
			expect(isWalkable(layout, [fixture.cell[0], fixture.cell[1] + 1]), fixture.id).toBe(true)
		}
	})

	it('lets people reach every prop and the music player, which stays silent at the desks', () => {
		for (const prop of layout.props) {
			expect(zoneAt(layout, prop.cell)).toBe(prop.zone)
			expect(standingSpots(layout, prop.cell, prop.radius).some(reachable), prop.id).toBe(true)
		}
		const player = layout.player!
		expect(zoneAt(layout, player.cell)).toBe(player.zone)
		expect(isWalkable(layout, player.cell)).toBe(false)
		expect(standingSpots(layout, player.cell, player.radius).some(reachable)).toBe(true)
		expect(player.hearing).toBeGreaterThan(player.radius)
		for (const desk of layout.desks ?? []) {
			expect(Math.hypot(desk.cell[0] - player.cell[0], desk.cell[1] - player.cell[1]), desk.id).toBeGreaterThan(player.hearing)
		}
	})
})
