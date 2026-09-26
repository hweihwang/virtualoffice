/**
 * SPDX-FileCopyrightText: 2026 Hoang Pham
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
import type { Cell, Layout } from './catalog.ts'

import { catalog, isWalkable } from './catalog.ts'

/**
 * A timed path. points[i] is reached at arriveAt[i] (server milliseconds).
 * The first point may be fractional when the path was changed mid-step.
 */
export interface Trajectory {
	id: number
	points: Cell[]
	arriveAt: number[]
}

export type Direction = 'north' | 'east' | 'south' | 'west'

/* Tie-break order for equally short paths: north, east, south, west. */
const NEIGHBOURS: [Direction, number, number][] = [
	['north', 0, -1],
	['east', 1, 0],
	['south', 0, 1],
	['west', -1, 0],
]

export function offset(direction: Direction): Cell {
	const found = NEIGHBOURS.find(([d]) => d === direction)!
	return [found[1], found[2]]
}

/**
 * Shortest four-way path from `from` to `to`, both included.
 * Returns null when the target is blocked, unreachable or further than maxEdges.
 */
export function findPath(layout: Layout, from: Cell, to: Cell, maxEdges = catalog.movement.maxPathEdges): Cell[] | null {
	if (!isWalkable(layout, from) || !isWalkable(layout, to)) {
		return null
	}
	const key = (cell: Cell) => cell[1] * layout.width + cell[0]
	const previous = new Map<number, number>([[key(from), -1]])
	let frontier: Cell[] = [from]
	for (let depth = 0; depth <= maxEdges && frontier.length > 0; depth++) {
		const next: Cell[] = []
		for (const cell of frontier) {
			if (cell[0] === to[0] && cell[1] === to[1]) {
				const path: Cell[] = []
				let k = key(cell)
				while (k !== -1) {
					path.unshift([k % layout.width, Math.floor(k / layout.width)])
					k = previous.get(k)!
				}
				return path
			}
			for (const [, dx, dy] of NEIGHBOURS) {
				const candidate: Cell = [cell[0] + dx, cell[1] + dy]
				if (isWalkable(layout, candidate) && !previous.has(key(candidate))) {
					previous.set(key(candidate), key(cell))
					next.push(candidate)
				}
			}
		}
		frontier = next
	}
	return null
}

/**
 * Furthest walkable cell in a straight line, at most `limit` steps away.
 */
export function straightPath(layout: Layout, from: Cell, direction: Direction, limit: number): Cell[] {
	const [dx, dy] = offset(direction)
	const path: Cell[] = [from]
	for (let i = 1; i <= limit; i++) {
		const next: Cell = [from[0] + dx * i, from[1] + dy * i]
		if (!isWalkable(layout, next)) {
			break
		}
		path.push(next)
	}
	return path
}

export function stationary(cell: Cell, at: number, id = 0): Trajectory {
	return { id, points: [cell], arriveAt: [at] }
}

export function endsAt(trajectory: Trajectory): number {
	return trajectory.arriveAt[trajectory.arriveAt.length - 1]
}

export function finalCell(trajectory: Trajectory): Cell {
	return trajectory.points[trajectory.points.length - 1]
}

/**
 * Position at time t, clamped to the first and last point.
 */
export function positionAt(trajectory: Trajectory, t: number): Cell {
	const { points, arriveAt } = trajectory
	if (t <= arriveAt[0] || points.length === 1) {
		return points[0]
	}
	for (let i = 1; i < points.length; i++) {
		if (t < arriveAt[i]) {
			const span = arriveAt[i] - arriveAt[i - 1]
			const f = span <= 0 ? 1 : (t - arriveAt[i - 1]) / span
			const [ax, ay] = points[i - 1]
			const [bx, by] = points[i]
			return [ax + (bx - ax) * f, ay + (by - ay) * f]
		}
	}
	return points[points.length - 1]
}

/**
 * Facing direction at time t; `fallback` when not moving.
 */
export function directionAt(trajectory: Trajectory, t: number, fallback: Direction): Direction {
	const { points, arriveAt } = trajectory
	for (let i = 1; i < points.length; i++) {
		if (t < arriveAt[i] || i === points.length - 1) {
			const dx = points[i][0] - points[i - 1][0]
			const dy = points[i][1] - points[i - 1][1]
			if (dx === 0 && dy === 0) {
				return fallback
			}
			if (Math.abs(dx) >= Math.abs(dy)) {
				return dx > 0 ? 'east' : 'west'
			}
			return dy > 0 ? 'south' : 'north'
		}
	}
	return fallback
}

export function isMoving(trajectory: Trajectory, t: number): boolean {
	return t < endsAt(trajectory)
}

/**
 * The cell a new path must start from at time t: the end of the step in
 * progress, or the current cell when standing still.
 */
export function nextStop(trajectory: Trajectory, t: number): { cell: Cell, at: number, from: Cell } {
	const { points, arriveAt } = trajectory
	for (let i = 1; i < points.length; i++) {
		if (t < arriveAt[i]) {
			return { cell: points[i], at: arriveAt[i], from: positionAt(trajectory, t) }
		}
	}
	const last = finalCell(trajectory)
	return { cell: last, at: t, from: last }
}

/**
 * Keep following `current` until the point `path[0]`, then follow `path`.
 * `path[0]` must be a cell of `current` that is not reached yet at time t,
 * or the resting cell when standing still. Steps already planned keep their
 * deadlines, so changing direction never speeds a character up.
 * Returns null when `path[0]` is not ahead on the current trajectory.
 */
export function rerouteVia(current: Trajectory, t: number, path: Cell[], msPerEdge = catalog.movement.msPerEdge): Trajectory | null {
	const { points, arriveAt } = current
	const [sx, sy] = path[0]
	let next = points.length
	for (let i = 1; i < points.length; i++) {
		if (arriveAt[i] > t) {
			next = i
			break
		}
	}
	const newPoints: Cell[] = []
	const newArrive: number[] = []
	let at = t
	if (next === points.length) {
		const [fx, fy] = finalCell(current)
		if (fx !== sx || fy !== sy) {
			return null
		}
		newPoints.push([sx, sy])
		newArrive.push(t)
	} else {
		let join = -1
		for (let k = next; k < points.length; k++) {
			if (points[k][0] === sx && points[k][1] === sy) {
				join = k
				break
			}
		}
		if (join === -1) {
			return null
		}
		newPoints.push(positionAt(current, t))
		newArrive.push(t)
		for (let k = next; k <= join; k++) {
			newPoints.push(points[k])
			newArrive.push(arriveAt[k])
		}
		at = arriveAt[join]
	}
	for (let i = 1; i < path.length; i++) {
		at += msPerEdge
		newPoints.push(path[i])
		newArrive.push(at)
	}
	return { id: current.id + 1, points: newPoints, arriveAt: newArrive }
}

/**
 * Reroute from the end of the step in progress.
 */
export function reroute(current: Trajectory, t: number, path: Cell[], msPerEdge = catalog.movement.msPerEdge): Trajectory {
	const result = rerouteVia(current, t, path, msPerEdge)
	if (result === null) {
		throw new Error('Path does not start at the next stop')
	}
	return result
}

/**
 * Adjacent, walkable and within the length limit.
 */
export function isValidPath(layout: Layout, path: Cell[], maxEdges = catalog.movement.maxPathEdges): boolean {
	if (path.length < 1 || path.length > maxEdges + 1 || !isWalkable(layout, path[0])) {
		return false
	}
	for (let i = 1; i < path.length; i++) {
		const [ax, ay] = path[i - 1]
		const [bx, by] = path[i]
		if (!isWalkable(layout, path[i]) || Math.abs(ax - bx) + Math.abs(ay - by) !== 1) {
			return false
		}
	}
	return true
}
