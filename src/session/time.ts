/**
 * SPDX-FileCopyrightText: 2026 Hoang Pham
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
import type { TimeInfo, WorkingHours } from '../types.ts'

/**
 * Local times and working hours across time zones, with Intl only. Ranges
 * are minutes after local midnight; one that crosses midnight ends after 1440.
 */

const DAY_MS = 86_400_000
const formatters = new Map<string, Intl.DateTimeFormat>()

function parts(ms: number, timeZone: string): { year: number, month: number, day: number, minutes: number } {
	let format = formatters.get(timeZone)
	if (!format) {
		format = new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric' })
		formatters.set(timeZone, format)
	}
	const values: Record<string, number> = {}
	for (const part of format.formatToParts(ms)) {
		if (part.type !== 'literal') {
			values[part.type] = Number(part.value)
		}
	}
	return { year: values.year, month: values.month, day: values.day, minutes: (values.hour % 24) * 60 + values.minute }
}

/** Offset of a zone from UTC at an instant, in ms. */
function offset(ms: number, timeZone: string): number {
	const p = parts(ms, timeZone)
	const wall = Date.UTC(p.year, p.month - 1, p.day, Math.floor(p.minutes / 60), p.minutes % 60)
	return wall - (ms - (ms % 60_000))
}

/** The instant of a wall time in a zone: midnight of a local date plus minutes. */
function instant(year: number, month: number, day: number, minutes: number, timeZone: string): number {
	const wall = Date.UTC(year, month - 1, day) + minutes * 60_000
	const guess = wall - offset(wall, timeZone)
	return wall - offset(guess, timeZone)
}

/** ISO weekday, 1 for Monday to 7 for Sunday, of a local date. */
function weekday(year: number, month: number, day: number): number {
	return new Date(Date.UTC(year, month - 1, day)).getUTCDay() || 7
}

export function isValidZone(timeZone: string | null | undefined): timeZone is string {
	if (!timeZone) {
		return false
	}
	try {
		parts(0, timeZone)
		return true
	} catch {
		return false
	}
}

/** "22:40" in the person's zone, in the viewer's locale. */
export function localTime(ms: number, timeZone: string, locale?: string): string {
	return new Intl.DateTimeFormat(locale, { timeZone, hour: '2-digit', minute: '2-digit' }).format(ms)
}

/** Working intervals of a person as absolute times overlapping [from, until). */
function intervals(hours: WorkingHours, from: number, until: number): [number, number][] {
	const zone = hours.timeZone!
	const result: [number, number][] = []
	for (let t = from - DAY_MS; t < until + DAY_MS; t += DAY_MS) {
		const { year, month, day } = parts(t, zone)
		for (const [start, end] of hours.days[weekday(year, month, day)] ?? []) {
			const s = instant(year, month, day, start, zone)
			const e = instant(year, month, day, end, zone)
			if (e > from && s < until) {
				result.push([Math.max(s, from), Math.min(e, until)])
			}
		}
	}
	result.sort((a, b) => a[0] - b[0])
	// Neighbouring days can repeat a range; merge overlaps.
	const merged: [number, number][] = []
	for (const range of result) {
		const last = merged[merged.length - 1]
		if (last && range[0] <= last[1]) {
			last[1] = Math.max(last[1], range[1])
		} else {
			merged.push([...range])
		}
	}
	return merged
}

/** Whether the person works right now, or null when their time zone is unknown. */
export function isWorking(hours: WorkingHours | null | undefined, ms: number): boolean | null {
	if (!hours || !isValidZone(hours.timeZone)) {
		return null
	}
	return intervals(hours, ms, ms + 1).length > 0
}

/**
 * Times today, in the viewer's zone, when everyone given works. Null when
 * fewer than two people have a known time zone.
 */
export function sharedHours(people: (WorkingHours | null | undefined)[], viewerZone: string, ms: number): [number, number][] | null {
	const known = people.filter((h): h is WorkingHours => Boolean(h && isValidZone(h.timeZone)))
	if (known.length < 2) {
		return null
	}
	const today = parts(ms, viewerZone)
	const from = instant(today.year, today.month, today.day, 0, viewerZone)
	const until = instant(today.year, today.month, today.day, 1440, viewerZone)
	let shared: [number, number][] = [[from, until]]
	for (const hours of known) {
		const next: [number, number][] = []
		for (const [s1, e1] of shared) {
			for (const [s2, e2] of intervals(hours, from, until)) {
				const s = Math.max(s1, s2)
				const e = Math.min(e1, e2)
				if (e > s) {
					next.push([s, e])
				}
			}
		}
		shared = next
	}
	return shared
}

/** The device's own zone, as the browser reports it. */
export function deviceZone(): string {
	return Intl.DateTimeFormat().resolvedOptions().timeZone
}

/** Whether two zones have the same offset at an instant, e.g. Asia/Saigon and Asia/Ho_Chi_Minh. */
export function sameOffset(a: string, b: string, ms: number): boolean {
	return offset(ms, a) === offset(ms, b)
}

/** The zone a person's clock is in: their Nextcloud setting, else the zone of their working hours. */
export function zoneOf(info: TimeInfo | null | undefined): string | null {
	if (isValidZone(info?.timeZone)) {
		return info.timeZone
	}
	return isValidZone(info?.hours.timeZone) ? info.hours.timeZone : null
}

/** "22:40" for a person, and whether that is outside their working hours. */
export function clockOf(info: TimeInfo | null | undefined, ms: number, locale?: string): { time: string, off: boolean } | null {
	const zone = zoneOf(info)
	if (zone === null) {
		return null
	}
	return { time: localTime(ms, zone, locale), off: isWorking(info!.hours, ms) === false }
}
