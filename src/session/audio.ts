/**
 * SPDX-FileCopyrightText: 2026 Hoang Pham
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

/**
 * Sound shared by the music player and voice: one AudioContext, and how
 * loud and how far left or right something sounds from where you stand.
 */

let context: AudioContext | null = null

/** The context once a click created it, or null. */
export function audioContext(): AudioContext | null {
	return context
}

/** Creates or resumes the context. Browsers allow this only in a click, such as Enter office. */
export function unlockAudio(): AudioContext | null {
	try {
		context ??= new AudioContext()
		if (context.state === 'suspended') {
			void context.resume()
		}
	} catch {
		return null
	}
	return context
}

/** 1 up to `full` cells away, 0 from `zero` cells on, and a smooth curve in between. */
export function falloff(distance: number, full: number, zero: number): number {
	if (distance <= full) {
		return 1
	}
	if (distance >= zero) {
		return 0
	}
	return (1 + Math.cos(Math.PI * (distance - full) / (zero - full))) / 2
}

/** Left (−) or right (+) from the horizontal offset in cells, never entirely on one side. */
export function pan(dx: number, range: number): number {
	return Math.max(-1, Math.min(1, dx / range)) * 0.8
}
