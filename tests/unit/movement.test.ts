import type { Cell } from '../../shared/catalog.ts'

/**
 * SPDX-FileCopyrightText: 2026 Hoang Pham
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
import { describe, expect, it } from 'vitest'
import { catalog, getLayout, isWalkable, zoneAt } from '../../shared/catalog.ts'
import { directionAt, findPath, isValidPath, nextStop, positionAt, reroute, rerouteVia, stationary, straightPath } from '../../shared/movement.ts'

const layout = getLayout('starter-office-v1')

describe('catalog', () => {
	it('puts every walkable cell into exactly one zone', () => {
		for (let y = 0; y < layout.height; y++) {
			for (let x = 0; x < layout.width; x++) {
				if (!isWalkable(layout, [x, y])) {
					continue
				}
				const matches = layout.zones.filter(({ rect: [zx, zy, w, h] }) => x >= zx && x < zx + w && y >= zy && y < zy + h)
				expect(matches.map((z) => z.id), `cell ${x},${y}`).toHaveLength(1)
			}
		}
	})

	it('can reach every walkable cell from the spawn', () => {
		for (let y = 0; y < layout.height; y++) {
			for (let x = 0; x < layout.width; x++) {
				if (isWalkable(layout, [x, y])) {
					expect(findPath(layout, layout.spawn[0], [x, y]), `cell ${x},${y}`).not.toBeNull()
				}
			}
		}
	})

	it('has walkable spawns and zone anchors, and reachable props', () => {
		layout.spawn.forEach((cell) => expect(isWalkable(layout, cell)).toBe(true))
		expect(layout.desks?.length).toBe(12)
		layout.desks?.forEach((desk) => expect(isWalkable(layout, desk.cell), desk.id).toBe(true))
		// Team resources hang on the wall above a spot you can walk to.
		expect(layout.fixtures?.length).toBe(6)
		layout.fixtures?.forEach((fixture) => expect(isWalkable(layout, [fixture.cell[0], fixture.cell[1] + 1]), fixture.id).toBe(true))
		for (const [zone, cell] of Object.entries(layout.zoneAnchors)) {
			expect(isWalkable(layout, cell)).toBe(true)
			expect(zoneAt(layout, cell)).toBe(zone)
		}
		for (const prop of layout.props) {
			const standable = [[0, 1], [1, 0], [0, -1], [-1, 0], [1, 1], [-1, 1], [1, -1], [-1, -1]]
				.map(([dx, dy]) => [prop.cell[0] + dx, prop.cell[1] + dy] as Cell)
				.filter((cell) => isWalkable(layout, cell) && Math.hypot(cell[0] - prop.cell[0], cell[1] - prop.cell[1]) <= prop.radius)
			expect(standable.length, prop.id).toBeGreaterThan(0)
		}
	})

	it('offers the documented choices', () => {
		expect(catalog.creatures).toEqual(['rabbit', 'cat', 'bear', 'bird'])
		expect(catalog.palettes).toHaveLength(8)
		expect(catalog.emotes.map((e) => e.id)).toEqual(['wave', 'heart', 'laugh', 'celebrate'])
	})
})

describe('findPath', () => {
	it('returns the shortest path including both ends', () => {
		const path = findPath(layout, [5, 17], [5, 13])!
		expect(path[0]).toEqual([5, 17])
		expect(path.at(-1)).toEqual([5, 13])
		expect(path).toHaveLength(5)
	})

	it('walks around furniture and through doors', () => {
		const path = findPath(layout, [5, 17], [26, 11])!
		for (let i = 1; i < path.length; i++) {
			expect(Math.abs(path[i][0] - path[i - 1][0]) + Math.abs(path[i][1] - path[i - 1][1])).toBe(1)
			expect(isWalkable(layout, path[i])).toBe(true)
		}
		expect(path.some(([x]) => x === 22)).toBe(true)
	})

	it('rejects blocked, outside and too distant targets', () => {
		expect(findPath(layout, [5, 17], [16, 10])).toBeNull()
		expect(findPath(layout, [5, 17], [40, 3])).toBeNull()
		expect(findPath(layout, [5, 17], [5.5, 3] as Cell)).toBeNull()
		expect(findPath(layout, [1, 18], [30, 2], 10)).toBeNull()
	})

	it('breaks ties north, east, south, west', () => {
		const path = findPath(layout, [5, 5], [6, 6])!
		expect(path).toEqual([[5, 5], [6, 5], [6, 6]])
	})
})

describe('straightPath', () => {
	it('stops before walls', () => {
		const path = straightPath(layout, [5, 5], 'north', 10)
		expect(path.at(-1)).toEqual([5, 2])
	})
})

describe('trajectories', () => {
	const ms = catalog.movement.msPerEdge

	it('interpolates and clamps positions', () => {
		const t = reroute(stationary([5, 5], 1000), 1000, [[5, 5], [6, 5], [7, 5]])
		expect(positionAt(t, 900)).toEqual([5, 5])
		expect(positionAt(t, 1000 + ms / 2)).toEqual([5.5, 5])
		expect(positionAt(t, 1000 + 2 * ms)).toEqual([7, 5])
		expect(positionAt(t, 99999)).toEqual([7, 5])
		expect(directionAt(t, 1100, 'south')).toBe('east')
	})

	it('keeps the deadline of the step in progress when rerouting', () => {
		const first = reroute(stationary([5, 5], 0), 0, [[5, 5], [6, 5], [7, 5], [8, 5]])
		const t = ms * 1.5
		const stop = nextStop(first, t)
		expect(stop.cell).toEqual([7, 5])
		expect(stop.at).toBe(2 * ms)
		const second = reroute(first, t, [[7, 5], [7, 6]])
		expect(second.points[0]).toEqual([6.5, 5])
		expect(second.arriveAt).toEqual([t, 2 * ms, 3 * ms])
		expect(second.id).toBe(first.id + 1)
	})

	it('never moves faster than one cell per step time under reroute spam', () => {
		let current = stationary([5, 13], 0)
		let t = 0
		for (let i = 0; i < 200; i++) {
			t += 37
			const stop = nextStop(current, t)
			const target: Cell = i % 2 === 0 ? [12, 13] : [2, 13]
			current = reroute(current, t, findPath(layout, stop.cell, target)!)
			const { points, arriveAt } = current
			for (let k = 1; k < points.length; k++) {
				const distance = Math.hypot(points[k][0] - points[k - 1][0], points[k][1] - points[k - 1][1])
				expect(arriveAt[k] - arriveAt[k - 1]).toBeGreaterThanOrEqual(distance * ms - 1e-9)
			}
		}
	})

	it('stops at the end of the current step', () => {
		const moving = reroute(stationary([5, 5], 0), 0, [[5, 5], [6, 5], [7, 5]])
		const stop = nextStop(moving, 100)
		const stopped = reroute(moving, 100, [stop.cell])
		expect(stopped.points).toEqual([[5.4, 5], [6, 5]])
		expect(stopped.arriveAt).toEqual([100, ms])
	})

	it('joins a later planned cell without changing its deadline', () => {
		const first = reroute(stationary([5, 5], 0), 0, [[5, 5], [6, 5], [7, 5], [8, 5]])
		const joined = rerouteVia(first, 100, [[7, 5], [7, 6]])!
		expect(joined.points).toEqual([[5.4, 5], [6, 5], [7, 5], [7, 6]])
		expect(joined.arriveAt).toEqual([100, ms, 2 * ms, 3 * ms])
	})

	it('rejects a start that was already passed or is not on the path', () => {
		const first = reroute(stationary([5, 5], 0), 0, [[5, 5], [6, 5], [7, 5]])
		expect(rerouteVia(first, ms + 10, [[6, 5], [6, 6]])).toBeNull()
		expect(rerouteVia(first, 10, [[9, 9]])).toBeNull()
		expect(rerouteVia(stationary([5, 5], 0), 10, [[6, 5]])).toBeNull()
	})
})

describe('isValidPath', () => {
	it('accepts adjacent walkable cells only', () => {
		expect(isValidPath(layout, [[5, 5]])).toBe(true)
		expect(isValidPath(layout, [[5, 5], [6, 5], [6, 6]])).toBe(true)
		expect(isValidPath(layout, [[5, 5], [7, 5]])).toBe(false)
		expect(isValidPath(layout, [[5, 5], [6, 6]])).toBe(false)
		expect(isValidPath(layout, [[15, 10], [16, 10]])).toBe(false)
		expect(isValidPath(layout, [])).toBe(false)
		expect(isValidPath(layout, Array.from({ length: 70 }, (_, i) => [5, 5 + (i % 2)] as Cell))).toBe(false)
	})
})
