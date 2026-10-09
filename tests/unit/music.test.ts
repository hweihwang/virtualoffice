/**
 * SPDX-FileCopyrightText: 2026 Hoang Pham
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
import type { MusicState } from '../../src/types.ts'

import { describe, expect, it } from 'vitest'
import { falloff, pan } from '../../src/session/audio.ts'
import { musicGain, needsSeek, nextSeekLead, playPosition } from '../../src/session/music.ts'

const music: MusicState = {
	uid: 'alice',
	name: 'Alice',
	startedAt: 1_000_000,
	tracks: [{ title: 'One', durationMs: 60_000 }, { title: 'Two', durationMs: 30_000 }],
}

describe('music player', () => {
	it('plays the same spot for everyone and loops the playlist', () => {
		expect(playPosition(music, 1_000_000)).toEqual({ index: 0, offsetMs: 0 })
		expect(playPosition(music, 1_045_500)).toEqual({ index: 0, offsetMs: 45_500 })
		expect(playPosition(music, 1_060_000)).toEqual({ index: 1, offsetMs: 0 })
		expect(playPosition(music, 1_089_999)).toEqual({ index: 1, offsetMs: 29_999 })
		expect(playPosition(music, 1_090_000 + 90_000 * 3 + 61_000)).toEqual({ index: 1, offsetMs: 1_000 })
		// A clock slightly behind the start still lands in the playlist.
		expect(playPosition(music, 999_000)).toEqual({ index: 1, offsetMs: 29_000 })
		expect(playPosition({ ...music, tracks: [] }, 1_000_000)).toBeNull()
	})

	it('seeks when two windows would sound apart, but not again while a seek settles', () => {
		expect(needsSeek(40, 5000)).toBe(false)
		expect(needsSeek(-60, 5000)).toBe(false)
		expect(needsSeek(80, 5000)).toBe(true)
		expect(needsSeek(-300, 5000)).toBe(true)
		expect(needsSeek(300, 500)).toBe(false)
	})

	it('learns how late a seek lands and aims that much ahead', () => {
		// Landed 290 ms behind: next time seek 290 ms ahead.
		expect(nextSeekLead(0, -290)).toBe(290)
		// Then 30 ms too far ahead: pull back a little.
		expect(nextSeekLead(290, 30)).toBe(260)
		expect(nextSeekLead(0, 200)).toBe(0)
		expect(nextSeekLead(1400, -400)).toBe(1500)
	})

	it('is full volume at the player and silent at the desks', () => {
		expect(falloff(1, 1.5, 6)).toBe(1)
		expect(falloff(1.5, 1.5, 6)).toBe(1)
		expect(falloff(3.75, 1.5, 6)).toBeCloseTo(0.5)
		expect(falloff(5.9, 1.5, 6)).toBeGreaterThan(0)
		expect(falloff(6, 1.5, 6)).toBe(0)
		expect(falloff(12, 1.5, 6)).toBe(0)
		expect(musicGain(50, 1, 1.5, 6)).toBe(0.5)
		expect(musicGain(100, 3.75, 1.5, 6)).toBeCloseTo(0.5)
		expect(musicGain(0, 1, 1.5, 6)).toBe(0)
		expect(musicGain(80, null, 1.5, 6)).toBe(0)
		expect(musicGain(80, 6.7, 1.5, 6)).toBe(0)
	})

	it('pans left and right by where the sound is', () => {
		expect(pan(0, 5)).toBe(0)
		expect(pan(-2.5, 5)).toBeCloseTo(-0.4)
		expect(pan(10, 5)).toBeCloseTo(0.8)
		expect(pan(-10, 5)).toBeCloseTo(-0.8)
	})
})
