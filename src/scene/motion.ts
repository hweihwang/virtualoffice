/**
 * SPDX-FileCopyrightText: 2026 Hoang Pham
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
import type { Cell } from '../../shared/catalog.ts'
import type { Direction, Trajectory } from '../../shared/movement.ts'

import { directionAt, endsAt, isMoving, positionAt } from '../../shared/movement.ts'

/** Remote walks older than this are shown at their current position instead of replayed. */
export const MAX_REPLAY_LAG = 3000
const BLEND_MS = 120

/**
 * How one character is shown. Remote walks that arrive late (for example by
 * polling) are replayed from their start with a small delay, so every walk
 * is visible instead of characters jumping. The delay fades out while the
 * character stands still.
 */
export class Motion {
	private current: Trajectory
	private queued: Trajectory | null = null
	private lag = 0
	private facing: Direction = 'south'
	private blendFrom: Cell | null = null
	private blendStart = 0

	constructor(trajectory: Trajectory, serverNow: number, private immediate = false) {
		this.current = trajectory
		this.adoptLag(trajectory, serverNow)
	}

	get trajectory(): Trajectory {
		return this.queued ?? this.current
	}

	get displayLag(): number {
		return this.lag
	}

	/**
	 * Accept a newer trajectory. Local predictions use `immediate` and blend
	 * small corrections instead of replaying.
	 */
	update(trajectory: Trajectory, serverNow: number): void {
		if (trajectory.id < this.trajectory.id) {
			return
		}
		if (this.immediate) {
			this.blendFrom = this.positionAt(serverNow)
			this.blendStart = serverNow
			this.current = trajectory
			this.queued = null
			return
		}
		const shown = serverNow - this.lag
		if (!isMoving(this.current, shown) && this.queued === null) {
			this.current = trajectory
			this.adoptLag(trajectory, serverNow)
		} else {
			this.queued = trajectory
		}
	}

	/**
	 * Displayed position and facing at the given server time.
	 */
	sample(serverNow: number, dt = 0): { position: Cell, facing: Direction, moving: boolean } {
		let shown = serverNow - this.lag
		if (this.queued !== null && shown >= this.queued.arriveAt[0]) {
			this.current = this.queued
			this.queued = null
		}
		if (this.queued === null && !isMoving(this.current, shown) && this.lag > 0) {
			this.lag = Math.max(0, this.lag - Math.max(dt, 0) * 0.5)
			shown = serverNow - this.lag
		}
		const moving = isMoving(this.current, shown) || this.queued !== null
		this.facing = directionAt(this.current, shown, this.facing)
		return { position: this.positionAt(serverNow), facing: this.facing, moving }
	}

	private positionAt(serverNow: number): Cell {
		const [x, y] = positionAt(this.current, serverNow - this.lag)
		if (this.blendFrom !== null) {
			const f = (serverNow - this.blendStart) / BLEND_MS
			if (f >= 1 || f < 0) {
				this.blendFrom = null
			} else {
				const [bx, by] = this.blendFrom
				const [cx, cy] = positionAt(this.current, this.blendStart - this.lag)
				return [x + (bx - cx) * (1 - f), y + (by - cy) * (1 - f)]
			}
		}
		return [x, y]
	}

	private adoptLag(trajectory: Trajectory, serverNow: number): void {
		if (this.immediate) {
			this.lag = 0
			return
		}
		const late = serverNow - trajectory.arriveAt[0]
		this.lag = late > 0 && late <= MAX_REPLAY_LAG && serverNow < endsAt(trajectory) + late ? late : 0
	}
}
