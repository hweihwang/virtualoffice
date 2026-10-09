/**
 * SPDX-FileCopyrightText: 2026 Hoang Pham
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
import type { MusicState } from '../types.ts'

import { audioContext, falloff } from './audio.ts'

/** Seek when the element is this far from the shared position: two windows in one room then sound as one. */
export const RESYNC_MS = 60
/** Seeks need a moment to settle; check again only after this long. */
export const SEEK_SETTLE_MS = 2000

/**
 * Whether to jump to the shared position. Changing the playback speed
 * instead would be smoother, but Safari then reports positions that are
 * hundreds of milliseconds off.
 */
export function needsSeek(driftMs: number, sinceLastSeekMs: number): boolean {
	return Math.abs(driftMs) > RESYNC_MS && sinceLastSeekMs >= SEEK_SETTLE_MS
}

/**
 * How far ahead of the shared position to seek. A seek that has to fetch
 * from the server lands late, Safari's by about 300 ms, so each seek that
 * still lands off moves the next one by the remaining drift.
 */
export function nextSeekLead(leadMs: number, driftMs: number): number {
	return Math.max(0, Math.min(1500, leadMs - driftMs))
}
const TICK_MS = 250

/** Which track plays now and how far into it: the playlist loops from when it started. */
export function playPosition(music: MusicState, now: number): { index: number, offsetMs: number } | null {
	const total = music.tracks.reduce((sum, track) => sum + track.durationMs, 0)
	if (total <= 0) {
		return null
	}
	let elapsed = (((now - music.startedAt) % total) + total) % total
	for (const [index, track] of music.tracks.entries()) {
		if (elapsed < track.durationMs) {
			return { index, offsetMs: elapsed }
		}
		elapsed -= track.durationMs
	}
	return { index: 0, offsetMs: 0 }
}

/** Volume (0 to 100) times how close you are: full within radius, silent from hearing on. */
export function musicGain(volume: number, distance: number | null, radius: number, hearing: number): number {
	if (distance === null || volume <= 0) {
		return 0
	}
	return (Math.min(volume, 100) / 100) * falloff(distance, radius, hearing)
}

export interface MusicInput {
	music: MusicState | null
	now: number
	/** Cells from you to the player, or null when you are not inside. */
	distance: number | null
	volume: number
}

/**
 * Plays the office's music in sync with everyone: an <audio> element
 * through the shared AudioContext, louder the closer you stand. Out of
 * hearing, the element stops and drops its source, so nothing downloads.
 *
 * The track starts streaming at once and downloads alongside; once it is
 * in memory, playback moves to that copy. Seeks are then instant: through
 * the network, Safari stalls and seeks land hundreds of milliseconds late,
 * which two windows in one room hear as an echo.
 */
export class MusicPlayer {
	private audio = new Audio()
	private source: MediaElementAudioSourceNode | null = null
	private gain: GainNode | null = null
	private src = ''
	private local: string | null = null
	private download: AbortController | null = null
	private seekedAt = 0
	/** Learned per window: how much later than asked a seek starts playing. */
	private seekLead = 0
	private timer: ReturnType<typeof setInterval>

	constructor(
		private read: () => MusicInput,
		private url: (index: number, startedAt: number) => string,
		private player: { radius: number, hearing: number },
	) {
		this.audio.preload = 'auto'
		this.audio.addEventListener('loadedmetadata', () => this.seek())
		this.timer = setInterval(() => this.update(), TICK_MS)
	}

	/** Whether music can be heard right now. */
	get playing(): boolean {
		return this.src !== '' && !this.audio.paused
	}

	update(): void {
		const { music, now, distance, volume } = this.read()
		const level = music ? musicGain(volume, distance, this.player.radius, this.player.hearing) : 0
		const position = music ? playPosition(music, now) : null
		if (!music || !position || level <= 0) {
			this.silence()
			return
		}
		this.connect(level)
		const src = this.url(position.index, music.startedAt)
		if (this.src !== src) {
			this.release()
			this.src = src
			this.audio.src = src
			void this.audio.play().catch(() => {})
			this.fetchTrack(src)
			return
		}
		if (this.audio.ended) {
			// The file ended a little before its slot; when the playlist starts over, play it again.
			if (position.offsetMs + 750 < this.audio.currentTime * 1000) {
				this.audio.currentTime = position.offsetMs / 1000
				void this.audio.play().catch(() => {})
			}
			return
		}
		if (this.audio.paused) {
			void this.audio.play().catch(() => {})
		}
		this.seek(position.offsetMs)
	}

	/** Downloads the track; playback moves to the copy in memory when it arrives. */
	private fetchTrack(src: string): void {
		const download = new AbortController()
		this.download = download
		fetch(src, { signal: download.signal, credentials: 'same-origin' })
			.then((response) => response.ok ? response.blob() : Promise.reject(new Error(`HTTP ${response.status}`)))
			.then((blob) => {
				if (this.src !== src || download.signal.aborted) {
					return
				}
				this.local = URL.createObjectURL(blob)
				this.audio.src = this.local
				this.seekedAt = 0
				this.seekLead = 0
				void this.audio.play().catch(() => {})
			})
			// Streaming goes on as before.
			.catch(() => {})
	}

	/** Stops a download and frees the copy in memory. */
	private release(): void {
		this.download?.abort()
		this.download = null
		if (this.local !== null) {
			URL.revokeObjectURL(this.local)
			this.local = null
		}
	}

	/** How long sound takes from the element to the speakers; the element runs that much ahead. */
	private latencyMs(): number {
		const context = audioContext()
		return context ? ((context.outputLatency || context.baseLatency || 0) * 1000) : 0
	}

	dispose(): void {
		clearInterval(this.timer)
		this.silence()
		this.source?.disconnect()
		this.gain?.disconnect()
	}

	/** Jumps to the shared position when the element is too far from it. */
	private seek(offsetMs?: number): void {
		const { music, now } = this.read()
		const shared = offsetMs ?? (music ? playPosition(music, now)?.offsetMs : undefined)
		if (shared === undefined || this.audio.readyState < HTMLMediaElement.HAVE_METADATA) {
			return
		}
		const target = shared + this.latencyMs()
		const drift = this.audio.currentTime * 1000 - target
		if (needsSeek(drift, Date.now() - this.seekedAt)) {
			if (this.seekedAt !== 0) {
				this.seekLead = nextSeekLead(this.seekLead, drift)
			}
			this.seekedAt = Date.now()
			this.audio.currentTime = (target + this.seekLead) / 1000
		}
	}

	/**
	 * Sets the volume on the element itself. Only where that is ignored (iOS
	 * keeps every element at full volume) the sound goes through the shared
	 * context: in Safari on macOS, a routed element stalls and falls behind.
	 */
	private connect(level: number): void {
		if (this.volumeWorks()) {
			this.audio.volume = level
			return
		}
		const context = audioContext()
		if (context && !this.source) {
			this.source = context.createMediaElementSource(this.audio)
			this.gain = context.createGain()
			this.gain.gain.value = 0
			this.source.connect(this.gain).connect(context.destination)
		}
		if (this.gain && context) {
			this.gain.gain.setTargetAtTime(level, context.currentTime, 0.15)
		} else {
			this.audio.volume = level
		}
	}

	private volumeChecked: boolean | null = null

	/** Whether the element's volume can be changed; iOS reports 1 whatever was set. */
	private volumeWorks(): boolean {
		if (this.volumeChecked === null) {
			const probe = new Audio()
			probe.volume = 0.5
			this.volumeChecked = probe.volume === 0.5
		}
		return this.volumeChecked
	}

	private silence(): void {
		if (this.src === '') {
			return
		}
		this.src = ''
		this.audio.pause()
		this.audio.removeAttribute('src')
		this.audio.load()
		this.release()
	}
}

/** Duration of an audio file the browser can read, for the shared timeline. */
export function audioDuration(url: string): Promise<number> {
	return new Promise((resolve) => {
		const probe = new Audio()
		probe.preload = 'metadata'
		const done = (ms: number) => {
			probe.removeAttribute('src')
			probe.load()
			resolve(ms)
		}
		probe.addEventListener('loadedmetadata', () => done(Number.isFinite(probe.duration) ? Math.round(probe.duration * 1000) : 0))
		probe.addEventListener('error', () => done(0))
		probe.src = url
	})
}
