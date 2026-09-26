/**
 * SPDX-FileCopyrightText: 2026 Hoang Pham
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
import type { Cell, Prop } from '../../shared/catalog.ts'

export interface Actor {
	uid: string
	cell: Cell
	/** The reaction showing now, if any. */
	emote: { id: string, startedAt: number } | null
}

export interface Pair {
	uids: [string, string]
	emote: string
	startedAt: number
}

/** Reactions this close in time count as done together. */
export const PAIR_WINDOW_MS = 1500
/** How far apart, in cells, two people can react together. */
export const PAIR_DISTANCE = 3

/**
 * People reacting together: the same reaction, close by, at nearly the same
 * time. Everyone is in at most one pair, the earliest.
 */
export function findPairs(actors: Actor[]): Pair[] {
	const reacting = actors
		.filter((a): a is Actor & { emote: NonNullable<Actor['emote']> } => a.emote !== null)
		.sort((a, b) => a.emote.startedAt - b.emote.startedAt || a.uid.localeCompare(b.uid))
	const paired = new Set<string>()
	const pairs: Pair[] = []
	reacting.forEach((a, i) => {
		if (paired.has(a.uid)) {
			return
		}
		const b = reacting.slice(i + 1).find((other) => !paired.has(other.uid)
			&& other.emote.id === a.emote.id
			&& other.emote.startedAt - a.emote.startedAt <= PAIR_WINDOW_MS
			&& distance(a.cell, other.cell) <= PAIR_DISTANCE)
		if (b) {
			paired.add(a.uid)
			paired.add(b.uid)
			pairs.push({ uids: [a.uid, b.uid], emote: a.emote.id, startedAt: a.emote.startedAt })
		}
	})
	return pairs
}

/**
 * People within reach of a prop.
 */
export function atProp(actors: Actor[], prop: Prop): string[] {
	return actors.filter((a) => distance(a.cell, prop.cell) <= prop.radius + 1e-9).map((a) => a.uid)
}

function distance(a: Cell, b: Cell): number {
	return Math.hypot(a[0] - b[0], a[1] - b[1])
}
