/**
 * SPDX-FileCopyrightText: 2026 Hoang Pham
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
import type { Cell } from '../../shared/catalog.ts'
import type { VoiceCandidate } from '../../src/session/voice.ts'

import { describe, expect, it, vi } from 'vitest'
import { getLayout } from '../../shared/catalog.ts'
import { CONNECT_CELLS, DISCONNECT_CELLS, isOfferer, MAX_PEERS, SeenSignals, voicePeers } from '../../src/session/voice.ts'

vi.mock('@nextcloud/axios', () => ({ default: {} }))
vi.mock('@nextcloud/router', () => ({ generateOcsUrl: (p: string) => p }))

const layout = getLayout('starter-office-v1')
const tab = (n: number) => n.toString(16).padStart(32, '0')

function person(n: number, position: Cell, extra: Partial<VoiceCandidate> = {}): VoiceCandidate {
	return { uid: `u${n}`, session: tab(n), mode: 'available', position, ...extra }
}

describe('who hears whom', () => {
	// In the common room, which runs from x 11 to 22.
	const me = person(1, [12, 12])

	it('connects people with voice on in the same zone within 5 cells', () => {
		const peers = voicePeers(layout, me, [
			person(2, [15, 12]),
			person(3, [12, 12 + CONNECT_CELLS]),
			person(4, [12, 18]),
			person(5, [13, 13], { session: null }),
			person(6, [13, 12], { mode: 'focus' }),
			// The entrance is next door, but another zone.
			person(7, [9, 12]),
		], new Set())
		expect([...peers.keys()]).toEqual([tab(2), tab(3)])
		expect(peers.get(tab(2))).toBe(3)
	})

	it('keeps a connection until 7 cells, so walking back and forth does not flap', () => {
		const walker = person(2, [12 + 6, 12])
		expect(voicePeers(layout, me, [walker], new Set()).has(tab(2))).toBe(false)
		expect(voicePeers(layout, me, [walker], new Set([tab(2)])).has(tab(2))).toBe(true)
		const far = person(2, [12 + DISCONNECT_CELLS + 0.5, 12])
		expect(voicePeers(layout, me, [far], new Set([tab(2)])).has(tab(2))).toBe(false)
	})

	it('is silent at the focus desks and while you are not open to chat', () => {
		const deskA = person(1, [24, 4])
		const deskB = person(2, [25, 4])
		expect(voicePeers(layout, deskA, [deskB], new Set()).size).toBe(0)
		expect(voicePeers(layout, { ...me, mode: 'away' }, [person(2, [13, 12])], new Set()).size).toBe(0)
		expect(voicePeers(layout, { ...me, session: null }, [person(2, [13, 12])], new Set()).size).toBe(0)
	})

	it('keeps the nearest six', () => {
		const crowd = Array.from({ length: 9 }, (_, i) => person(i + 2, [12 + (i % 3), 13 + Math.floor(i / 3)] as Cell))
		const peers = voicePeers(layout, me, crowd, new Set())
		expect(peers.size).toBe(MAX_PEERS)
		const farthestKept = Math.max(...peers.values())
		const dropped = crowd.filter((p) => !peers.has(p.session!))
		expect(dropped.every((p) => Math.hypot(p.position[0] - 12, p.position[1] - 12) >= farthestKept)).toBe(true)
	})

	it('lets the smaller tab id send the offer', () => {
		expect(isOfferer(tab(1), tab(2))).toBe(true)
		expect(isOfferer(tab(2), tab(1))).toBe(false)
	})

	it('handles a signal once when it comes by push and by poll', () => {
		const seen = new SeenSignals()
		expect(seen.first(5)).toBe(true)
		expect(seen.first(5)).toBe(false)
		expect(seen.first(6)).toBe(true)
	})
})
