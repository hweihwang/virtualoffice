/**
 * SPDX-FileCopyrightText: 2026 Hoang Pham
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

interface Sample {
	offset: number
	rtt: number
}

/**
 * Estimates server time from request timings. Uses the fastest recent round
 * trips, since slow responses give the least reliable offset.
 */
export class ServerClock {
	private samples: Sample[] = []
	private offset: number | null = null

	constructor(private now: () => number = () => performance.timeOrigin + performance.now()) {}

	/**
	 * Record a response: local send time, local receive time, server time.
	 */
	observe(sentAt: number, receivedAt: number, serverTime: number): void {
		const rtt = Math.max(0, receivedAt - sentAt)
		this.samples.push({ offset: serverTime - (sentAt + receivedAt) / 2, rtt })
		if (this.samples.length > 12) {
			this.samples.shift()
		}
		const best = [...this.samples].sort((a, b) => a.rtt - b.rtt).slice(0, 3)
		const target = best.reduce((sum, s) => sum + s.offset, 0) / best.length
		// Move gradually once calibrated so remote characters do not jump.
		this.offset = this.offset === null || Math.abs(target - this.offset) > 1000
			? target
			: this.offset + (target - this.offset) * 0.3
	}

	get calibrated(): boolean {
		return this.offset !== null
	}

	/** Typical one-way latency, used to plan paths slightly ahead. */
	get latency(): number {
		if (this.samples.length === 0) {
			return 150
		}
		return Math.min(...this.samples.map((s) => s.rtt)) / 2
	}

	serverNow(): number {
		return this.now() + (this.offset ?? 0)
	}

	localNow(): number {
		return this.now()
	}
}
