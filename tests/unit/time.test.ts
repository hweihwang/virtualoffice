/**
 * SPDX-FileCopyrightText: 2026 Hoang Pham
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
import type { WorkingHours } from '../../src/types.ts'

import { describe, expect, it } from 'vitest'
import { isValidZone, isWorking, localTime, sameOffset, sharedHours } from '../../src/session/time.ts'

function weekdays(timeZone: string | null, start = 540, end = 1020): WorkingHours {
	const days: WorkingHours['days'] = { 1: [], 2: [], 3: [], 4: [], 5: [], 6: [], 7: [] }
	for (let d = 1; d <= 5; d++) {
		days[d] = [[start, end]]
	}
	return { timeZone, days, default: false }
}

const at = (iso: string) => Date.parse(iso)
const hhmm = (ms: number, zone: string) => localTime(ms, zone, 'en-GB')

describe('time zones', () => {
	it('shows the local time in the person\'s zone', () => {
		expect(hhmm(at('2027-03-15T21:40:00Z'), 'Asia/Ho_Chi_Minh')).toBe('04:40')
		expect(hhmm(at('2027-03-15T21:40:00Z'), 'Europe/Berlin')).toBe('22:40')
		expect(isValidZone('Mars/Olympus')).toBe(false)
		expect(isValidZone(null)).toBe(false)
	})

	it('knows working hours across the change to summer time', () => {
		const newYork = weekdays('America/New_York')
		// Friday 2027-03-12 is still winter time (UTC−5); Monday 2027-03-15 is summer time (UTC−4).
		expect(isWorking(newYork, at('2027-03-12T14:30:00Z'))).toBe(true)
		expect(isWorking(newYork, at('2027-03-12T13:30:00Z'))).toBe(false)
		expect(isWorking(newYork, at('2027-03-15T13:30:00Z'))).toBe(true)
		expect(isWorking(newYork, at('2027-03-15T21:30:00Z'))).toBe(false)
		expect(isWorking(newYork, at('2027-03-13T15:00:00Z'))).toBe(false)
		expect(isWorking(weekdays(null), at('2027-03-15T13:30:00Z'))).toBeNull()
		expect(isWorking(undefined, at('2027-03-15T13:30:00Z'))).toBeNull()
	})

	it('follows a shift past midnight into the next day', () => {
		// Sunday 22:00 to Monday 06:00 in Berlin.
		const night: WorkingHours = { timeZone: 'Europe/Berlin', days: { 1: [], 2: [], 3: [], 4: [], 5: [], 6: [], 7: [[1320, 1800]] }, default: false }
		expect(isWorking(night, at('2027-03-14T22:30:00Z'))).toBe(true)
		expect(isWorking(night, at('2027-03-15T04:30:00Z'))).toBe(true)
		expect(isWorking(night, at('2027-03-15T05:30:00Z'))).toBe(false)
		expect(isWorking(night, at('2027-03-14T20:30:00Z'))).toBe(false)
	})

	it('finds the hours everyone works today, in the viewer\'s zone', () => {
		const monday = at('2027-03-15T10:00:00Z')
		const berlin = weekdays('Europe/Berlin')
		const newYork = weekdays('America/New_York')
		// Berlin 09:00–17:00 is 08:00–16:00 UTC; New York 09:00–17:00 is 13:00–21:00 UTC.
		const [range] = sharedHours([berlin, newYork], 'Europe/Berlin', monday)!
		expect([hhmm(range[0], 'Europe/Berlin'), hhmm(range[1], 'Europe/Berlin')]).toEqual(['14:00', '17:00'])
		const hanoi = weekdays('Asia/Ho_Chi_Minh')
		expect(sharedHours([berlin, newYork, hanoi], 'Europe/Berlin', monday)).toEqual([])
		expect(sharedHours([berlin, weekdays(null)], 'Europe/Berlin', monday)).toBeNull()
		// A lunch break splits the shared time.
		const split: WorkingHours = { ...berlin, days: { ...berlin.days, 1: [[540, 720], [780, 1020]] } }
		expect(sharedHours([split, berlin], 'Europe/Berlin', monday)!.map(([s, e]) => `${hhmm(s, 'Europe/Berlin')}–${hhmm(e, 'Europe/Berlin')}`)).toEqual(['09:00–12:00', '13:00–17:00'])
	})

	it('treats zones with the same offset as the same', () => {
		expect(sameOffset('Asia/Saigon', 'Asia/Ho_Chi_Minh', at('2027-03-15T10:00:00Z'))).toBe(true)
		expect(sameOffset('Europe/Berlin', 'Europe/London', at('2027-03-15T10:00:00Z'))).toBe(false)
	})
})
