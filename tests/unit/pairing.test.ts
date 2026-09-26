/**
 * SPDX-FileCopyrightText: 2026 Hoang Pham
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
import type { Actor } from '../../src/session/pairing.ts'

import { describe, expect, it } from 'vitest'
import { getLayout } from '../../shared/catalog.ts'
import { atProp, findPairs, PAIR_WINDOW_MS } from '../../src/session/pairing.ts'

function actor(uid: string, cell: [number, number], emote: string | null = null, startedAt = 1000): Actor {
	return {
		uid,
		cell,
		emote: emote === null ? null : { id: emote, startedAt },
	}
}

describe('findPairs', () => {
	it('pairs the same reaction, close by and at nearly the same time', () => {
		expect(findPairs([actor('a', [5, 5], 'wave', 1000), actor('b', [6, 6], 'wave', 1000 + PAIR_WINDOW_MS)]))
			.toEqual([{ uids: ['a', 'b'], emote: 'wave', startedAt: 1000 }])
	})

	it.each([
		['different reactions', actor('b', [6, 5], 'heart')],
		['too far apart', actor('b', [9, 5], 'wave')],
		['too late', actor('b', [6, 5], 'wave', 1001 + PAIR_WINDOW_MS)],
		['no reaction', actor('b', [6, 5])],
	])('does not pair %s', (_name, other) => {
		expect(findPairs([actor('a', [5, 5], 'wave'), other])).toEqual([])
	})

	it('puts everyone in at most one pair, the earliest', () => {
		const pairs = findPairs([actor('c', [6, 5], 'wave', 1200), actor('a', [5, 5], 'wave', 1000), actor('b', [4, 5], 'wave', 1100)])
		expect(pairs).toEqual([{ uids: ['a', 'b'], emote: 'wave', startedAt: 1000 }])
	})
})

describe('atProp', () => {
	it('lists the people within reach of a prop', () => {
		const coffee = getLayout('starter-office-v1').props.find((p) => p.id === 'coffee')!
		expect(atProp([actor('a', [3, 2]), actor('b', [4, 2]), actor('c', [8, 8])], coffee)).toEqual(['a', 'b'])
	})
})
