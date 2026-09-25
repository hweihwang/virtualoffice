import type { Cell, Layout } from '../../shared/catalog.ts'
import type { Direction, Trajectory } from '../../shared/movement.ts'
/**
 * SPDX-FileCopyrightText: 2026 Hoang Pham
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
import type { OwnChange } from '../api.ts'
import type { CallState, DeskList, DeskOwner, EventBatch, FocusState, Participant, PropState, ResourceView, RoomEvent, Snapshot, UserStatusInfo } from '../types.ts'
import type { Actor, Pair } from './pairing.ts'

import { reactive } from 'vue'
import { getLayout, zoneAt } from '../../shared/catalog.ts'
import { finalCell, findPath, isMoving, nextStop, positionAt, rerouteVia, straightPath } from '../../shared/movement.ts'
import { ApiError } from '../api.ts'
import { MAX_REPLAY_LAG, Motion } from '../scene/motion.ts'
import { ServerClock } from './clock.ts'
import { atProp, findPairs } from './pairing.ts'

export type RoomStatus
	= | 'idle' | 'entering' | 'active' | 'reconnecting'
		| 'elsewhere' | 'full' | 'removed' | 'taken-over' | 'expired' | 'closed' | 'outdated' | 'left' | 'error'

export interface RoomApi {
	enter(token: string, session: string, takeover: boolean): Promise<Snapshot>
	poll(token: string, session: string, rev: number): Promise<{ changed: false, rev: number, serverTime: number } | ({ changed: true } & Snapshot)>
	move(token: string, session: string, path: Cell[]): Promise<OwnChange>
	stop(token: string, session: string): Promise<OwnChange>
	emote(token: string, session: string, emote: string): Promise<OwnChange>
	mode(token: string, session: string, mode: string): Promise<OwnChange>
	profile(token: string, session: string): Promise<OwnChange>
	interact(token: string, session: string, prop: string): Promise<{ outcome: string, serverTime: number }>
	leave(token: string, session: string): Promise<unknown>
	focus(token: string, session: string, minutes: number): Promise<{ focus: FocusState | null, serverTime: number }>
	leaveFocus(token: string, session: string): Promise<{ focus: FocusState | null, serverTime: number }>
	desks(token: string): Promise<DeskList>
	claimDesk(token: string, deskId: string): Promise<DeskList>
	releaseDesk(token: string, deskId: string): Promise<DeskList>
}

export interface PushChannel {
	/** Registers the handler and reports whether pushes can arrive. */
	listen(handler: (batch: EventBatch) => void): boolean
}

/** What Vue renders about a person; changes only on events, not per frame. */
export interface PersonView {
	uid: string
	name: string
	appearance: Participant['appearance']
	mode: string
	zone: string | null
	emote: Participant['emote']
	isYou: boolean
	note: string | null
	status: UserStatusInfo | null
	birthday: boolean
	focusing: boolean
}

export type Announcement
	= | { kind: 'enter' | 'leave', name: string }
		| { kind: 'pair', names: [string, string], emote: string, withYou: boolean }
		| { kind: 'focus-done', minutes: number }

export const POLL_INTERVAL = { polling: 1200, pushed: 5000, hidden: 8000, hiddenPushed: 15000 }
/** How often desks and statuses are refreshed while the office is visible; statuses have no events. */
export const DESKS_INTERVAL = 60_000
/** Someone new arrived: fetch their status soon, but not for every arrival in a burst. */
const DESKS_AFTER_ARRIVAL = 5_000
const RETRY_DELAYS = [1000, 2000, 4000, 8000, 10000]
/** A push for a change made just before a poll may still be on its way. */
const PUSH_GRACE_MS = 1000

export function newSession(): string {
	const bytes = new Uint8Array(16)
	crypto.getRandomValues(bytes)
	return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Client side of one office visit: entering, heartbeats, events, local
 * movement prediction and every way a visit can end.
 */
export class RoomSession {
	readonly state = reactive({
		status: 'idle' as RoomStatus,
		errorCode: '' as string,
		removedUntil: null as number | null,
		sameOffice: false,
		rev: -1,
		title: '',
		capacity: 0,
		decor: {} as Record<string, string>,
		people: [] as PersonView[],
		props: [] as PropState[],
		call: null as CallState | null,
		pushActive: false,
		announcements: [] as string[],
		configRev: 0,
		desks: [] as DeskOwner[],
		statuses: {} as Record<string, UserStatusInfo>,
		focus: null as FocusState | null,
		/** Team resources on the wall, set by the page that knows the Team. */
		resources: [] as ResourceView[],
	})

	readonly motions = new Map<string, Motion>()
	readonly clock = new ServerClock()
	private participants = new Map<string, Participant>()
	private effectStarts = new Map<string, number>()
	private announcedPairs = new Set<string>()
	private session = newSession()
	private generation = 0
	private layout: Layout
	private timer: ReturnType<typeof setTimeout> | null = null
	private retry = 0
	private pushHealthy = false
	private pushListening = false
	private missedPushes = 0
	private lastPushAt = 0
	private moveInFlight = false
	private pendingMove: (() => Cell[] | null) | null = null
	private heldDirection: Direction | null = null
	private pendingInteract: { prop: string, timer: ReturnType<typeof setTimeout> } | null = null
	private visible = true
	private desksRev = -1
	private deskTimer: ReturnType<typeof setTimeout> | null = null
	private desksFetchedAt = 0
	private focusTimer: ReturnType<typeof setTimeout> | null = null

	constructor(
		private token: string,
		private uid: string,
		private api: RoomApi,
		private push: PushChannel | null,
		private catalogHash: string,
		layoutId: string,
		private onAnnounce: (announcement: Announcement) => void = () => {},
	) {
		this.layout = getLayout(layoutId)
	}

	get sessionId(): string {
		return this.session
	}

	get layoutData(): Layout {
		return this.layout
	}

	get isActive(): boolean {
		return this.state.status === 'active' || this.state.status === 'reconnecting'
	}

	async enter(takeover = false): Promise<void> {
		if (this.state.status === 'entering') {
			return
		}
		this.state.status = 'entering'
		this.state.errorCode = ''
		try {
			const snapshot = await this.timed(() => this.api.enter(this.token, this.session, takeover))
			if (snapshot.catalogHash !== this.catalogHash) {
				this.state.status = 'outdated'
				await this.api.leave(this.token, this.session).catch(() => {})
				return
			}
			this.generation = snapshot.you?.generation ?? 1
			this.applySnapshot(snapshot)
			this.state.status = 'active'
			this.startPush()
			this.schedule()
			void this.refreshDesks()
		} catch (error) {
			this.fail(error, true)
		}
	}

	async leave(): Promise<void> {
		const wasActive = this.isActive
		this.stopTimers()
		this.state.status = 'left'
		if (wasActive) {
			await this.api.leave(this.token, this.session).catch(() => {})
		}
	}

	/** Stops without telling the server, e.g. when the page is going away and a beacon was sent. */
	dispose(): void {
		this.stopTimers()
	}

	setVisible(visible: boolean): void {
		this.visible = visible
		if (visible && this.isActive) {
			this.schedule(0)
			if (this.clock.localNow() - this.desksFetchedAt >= DESKS_INTERVAL) {
				this.scheduleDesks(0)
			}
		}
	}

	// Focus ------------------------------------------------------------------

	/**
	 * Starts a focus session of 25 or 50 minutes, or joins the running one,
	 * and walks to your desk, or to the focus desks without one.
	 */
	async startFocus(minutes: number): Promise<void> {
		await this.focusCommand(() => this.api.focus(this.token, this.session, minutes))
		if (!this.state.focus?.uids.includes(this.uid)) {
			return
		}
		const desk = this.layout.desks?.find((d) => d.id === this.myDesk?.deskId)
		if (!(desk && this.walkTo(desk.cell)) && this.state.people.find((p) => p.isYou)?.zone !== 'focus') {
			this.walkToZone('focus')
		}
	}

	async leaveFocus(): Promise<void> {
		await this.focusCommand(() => this.api.leaveFocus(this.token, this.session))
	}

	private async focusCommand(command: () => Promise<{ focus: FocusState | null, serverTime: number }>): Promise<void> {
		if (this.state.status !== 'active') {
			return
		}
		try {
			this.setFocus((await this.timed(command)).focus)
		} catch (error) {
			this.handleCommandError(error)
		}
	}

	/** Shows the session and, for its members, says when it is done. */
	private setFocus(focus: FocusState | null): void {
		this.state.focus = focus
		if (this.focusTimer !== null) {
			clearTimeout(this.focusTimer)
			this.focusTimer = null
		}
		if (focus !== null) {
			this.focusTimer = setTimeout(() => {
				this.focusTimer = null
				if (this.state.focus?.uids.includes(this.uid)) {
					this.onAnnounce({ kind: 'focus-done', minutes: focus.minutes })
				}
				this.state.focus = null
				this.refreshPeople()
			}, Math.max(0, focus.endsAt - this.clock.serverNow()))
		}
		this.refreshPeople()
	}

	// Desks ------------------------------------------------------------------

	/** Fetches desks and the status of owners and people inside. */
	async refreshDesks(): Promise<void> {
		if (!this.isActive) {
			return
		}
		this.desksFetchedAt = this.clock.localNow()
		try {
			this.applyDesks(await this.api.desks(this.token))
		} catch {
			// Keep the last list; the next refresh tries again.
		}
		if (this.isActive && this.visible) {
			this.scheduleDesks(DESKS_INTERVAL)
		}
	}

	async claimDesk(deskId: string): Promise<void> {
		await this.deskCommand(() => this.api.claimDesk(this.token, deskId))
	}

	/** Your desk in this office, if you have one. */
	get myDesk(): DeskOwner | null {
		return this.state.desks.find((d) => d.uid === this.uid) ?? null
	}

	/**
	 * Claims the free desk nearest to you and walks there. False when every desk is taken.
	 */
	async claimNearestDesk(): Promise<boolean> {
		const taken = new Set(this.state.desks.map((d) => d.deskId))
		const here = this.ownPosition() ?? [0, 0]
		const free = (this.layout.desks ?? [])
			.filter((d) => !taken.has(d.id))
			.sort((a, b) => Math.hypot(a.cell[0] - here[0], a.cell[1] - here[1]) - Math.hypot(b.cell[0] - here[0], b.cell[1] - here[1]))
		if (free.length === 0) {
			return false
		}
		await this.claimDesk(free[0].id)
		if (this.myDesk?.deskId === free[0].id) {
			this.walkTo(free[0].cell)
		}
		return true
	}

	async releaseDesk(deskId: string): Promise<void> {
		await this.deskCommand(() => this.api.releaseDesk(this.token, deskId))
	}

	private async deskCommand(command: () => Promise<DeskList>): Promise<void> {
		try {
			this.applyDesks(await command())
		} catch (error) {
			this.state.errorCode = error instanceof ApiError ? error.code : 'UNKNOWN'
		}
	}

	private applyDesks(list: DeskList): void {
		this.state.desks = list.desks
		this.state.statuses = list.statuses
		this.refreshPeople()
	}

	private scheduleDesks(delay: number): void {
		if (this.deskTimer !== null) {
			clearTimeout(this.deskTimer)
		}
		this.deskTimer = setTimeout(() => {
			this.deskTimer = null
			void this.refreshDesks()
		}, delay)
	}

	private desksChanged(rev: number): void {
		if (rev !== this.desksRev) {
			this.desksRev = rev
			if (this.isActive) {
				this.scheduleDesks(0)
			}
		}
	}

	private someoneArrived(): void {
		if (this.isActive) {
			this.scheduleDesks(Math.max(0, DESKS_AFTER_ARRIVAL - (this.clock.localNow() - this.desksFetchedAt)))
		}
	}

	// Movement ---------------------------------------------------------------

	/**
	 * Walk to a cell. Returns false when it cannot be reached.
	 */
	walkTo(target: Cell): boolean {
		if (this.state.status !== 'active') {
			return false
		}
		this.cancelInteract()
		const plan = () => {
			const own = this.ownMotion()
			if (own === null) {
				return null
			}
			const t = this.clock.serverNow()
			const stop = nextStop(own.trajectory, t + this.lead())
			const path = findPath(this.layout, roundCell(stop.cell), target)
			return path
		}
		if (plan() === null) {
			return false
		}
		this.queueMove(plan)
		return true
	}

	/**
	 * Walk into a zone: the free cell closest to its anchor, so people who
	 * pick the same zone stand next to each other instead of on one spot.
	 */
	walkToZone(zoneId: string): boolean {
		const anchor = this.layout.zoneAnchors[zoneId]
		const zone = this.layout.zones.find((z) => z.id === zoneId)
		if (!anchor || !zone) {
			return false
		}
		const taken = new Set<string>()
		for (const [uid, motion] of this.motions) {
			if (uid !== this.uid) {
				const [x, y] = finalCell(motion.trajectory)
				taken.add(`${Math.round(x)}:${Math.round(y)}`)
			}
		}
		const [zx, zy, w, h] = zone.rect
		const candidates: Cell[] = []
		for (let y = zy; y < zy + h; y++) {
			for (let x = zx; x < zx + w; x++) {
				if (this.layout.collision[y]?.[x] === '.' && !taken.has(`${x}:${y}`)) {
					candidates.push([x, y])
				}
			}
		}
		candidates.sort((a, b) => Math.hypot(a[0] - anchor[0], a[1] - anchor[1]) - Math.hypot(b[0] - anchor[0], b[1] - anchor[1]))
		return candidates.slice(0, 8).some((cell) => this.walkTo(cell))
	}

	/**
	 * Start walking in a direction until stopWalking().
	 */
	startWalking(direction: Direction): void {
		if (this.state.status !== 'active' || this.heldDirection === direction) {
			return
		}
		this.cancelInteract()
		this.heldDirection = direction
		this.queueMove(() => {
			const own = this.ownMotion()
			if (own === null || this.heldDirection === null) {
				return null
			}
			const stop = nextStop(own.trajectory, this.clock.serverNow() + this.lead())
			const path = straightPath(this.layout, roundCell(stop.cell), this.heldDirection, 12)
			return path.length > 1 ? path : null
		})
	}

	stopWalking(direction?: Direction): void {
		if (direction !== undefined && this.heldDirection !== direction) {
			return
		}
		this.heldDirection = null
		const own = this.ownMotion()
		if (this.state.status !== 'active' || own === null || !isMoving(own.trajectory, this.clock.serverNow())) {
			return
		}
		this.queueMove(() => {
			const current = this.ownMotion()
			if (current === null) {
				return null
			}
			const stop = nextStop(current.trajectory, this.clock.serverNow() + this.lead())
			return [roundCell(stop.cell)]
		})
	}

	/**
	 * Walk next to a prop and use it when arriving.
	 */
	useProp(propId: string): 'started' | 'walking' | 'unreachable' {
		const prop = this.layout.props.find((p) => p.id === propId)
		const own = this.ownMotion()
		if (!prop || own === null || this.state.status !== 'active') {
			return 'unreachable'
		}
		const t = this.clock.serverNow()
		const [x, y] = positionAt(own.trajectory, t)
		if (!isMoving(own.trajectory, t) && Math.hypot(x - prop.cell[0], y - prop.cell[1]) <= prop.radius) {
			this.interact(propId)
			return 'started'
		}
		const spots = standingSpots(this.layout, prop.cell, prop.radius)
		const from = roundCell(nextStop(own.trajectory, t + this.lead()).cell)
		const best = spots
			.map((cell) => ({ cell, path: findPath(this.layout, from, cell) }))
			.filter((s) => s.path !== null)
			.sort((a, b) => a.path!.length - b.path!.length)[0]
		if (!best) {
			return 'unreachable'
		}
		this.walkTo(best.cell)
		this.pendingInteract = { prop: propId, timer: setTimeout(() => this.interactOnArrival(propId), 300) }
		return 'walking'
	}

	private interactOnArrival(propId: string): void {
		const own = this.ownMotion()
		if (this.pendingInteract?.prop !== propId || own === null) {
			return
		}
		const t = this.clock.serverNow()
		if (isMoving(own.trajectory, t) || this.moveInFlight) {
			this.pendingInteract.timer = setTimeout(() => this.interactOnArrival(propId), 150)
			return
		}
		this.pendingInteract = null
		this.interact(propId, true)
	}

	private cancelInteract(): void {
		if (this.pendingInteract !== null) {
			clearTimeout(this.pendingInteract.timer)
			this.pendingInteract = null
		}
	}

	/** The local arrival estimate can run ahead of the server, so retry one "out of reach" after walking. */
	private async interact(propId: string, afterWalk = false): Promise<void> {
		try {
			await this.timed(() => this.api.interact(this.token, this.session, propId))
			this.schedule(0)
		} catch (error) {
			if (afterWalk && error instanceof ApiError && error.code === 'OUT_OF_REACH') {
				this.pendingInteract = { prop: propId, timer: setTimeout(() => {
					this.pendingInteract = null
					void this.interact(propId)
				}, 300) }
				return
			}
			this.handleCommandError(error)
		}
	}

	async emote(id: string): Promise<void> {
		await this.own(() => this.api.emote(this.token, this.session, id))
	}

	async setMode(mode: string): Promise<void> {
		await this.own(() => this.api.mode(this.token, this.session, mode))
	}

	async refreshProfile(): Promise<void> {
		await this.own(() => this.api.profile(this.token, this.session))
	}

	ownPosition(): Cell | null {
		const own = this.ownMotion()
		return own === null ? null : positionAt(own.trajectory, this.clock.serverNow())
	}

	/**
	 * Whether a timed effect (a reaction or prop animation) is showing. Effects
	 * that arrive late, for example by polling, play for their full length
	 * from when they arrived, like remote walks.
	 */
	isShowing(key: string, effect: { startedAt: number, endsAt: number }, now = this.clock.serverNow()): boolean {
		let shownFrom = this.effectStarts.get(key)
		if (shownFrom === undefined) {
			const late = now - effect.startedAt
			shownFrom = late > 0 && late <= MAX_REPLAY_LAG ? now : effect.startedAt
			this.effectStarts.set(key, shownFrom)
			if (this.effectStarts.size > 200) {
				this.effectStarts.delete(this.effectStarts.keys().next().value!)
			}
		}
		return now >= shownFrom - 50 && now < shownFrom + (effect.endsAt - effect.startedAt)
	}

	propShowing(id: string, now = this.clock.serverNow()): boolean {
		return this.state.props.some((p) => p.id === id && this.isShowing(`prop:${p.id}:${p.startedAt}`, p, now))
	}

	emoteShowing(person: PersonView, now = this.clock.serverNow()): boolean {
		return person.emote !== null && this.isShowing(`emote:${person.uid}:${person.emote.startedAt}`, person.emote, now)
	}

	/** People reacting together right now. */
	pairs(now = this.clock.serverNow()): Pair[] {
		return findPairs(this.actors(now))
	}

	/** People clinking cups: two or more at the coffee machine while it runs. */
	clinking(now = this.clock.serverNow()): string[] {
		const coffee = this.layout.props.find((p) => p.id === 'coffee')
		if (!coffee || !this.propShowing(coffee.id, now)) {
			return []
		}
		const there = atProp(this.actors(now), coffee)
		return there.length >= 2 ? there : []
	}

	private actors(now: number): Actor[] {
		return this.state.people.map((person) => ({
			uid: person.uid,
			cell: finalCell(this.motions.get(person.uid)?.trajectory ?? this.participants.get(person.uid)!.trajectory),
			emote: this.emoteShowing(person, now) ? person.emote : null,
		}))
	}

	private announcePairs(): void {
		const names = new Map(this.state.people.map((p) => [p.uid, p.name]))
		for (const pair of this.pairs()) {
			const key = `${pair.uids.join(':')}:${pair.startedAt}`
			if (this.announcedPairs.has(key)) {
				continue
			}
			this.announcedPairs.add(key)
			if (this.announcedPairs.size > 50) {
				this.announcedPairs.delete(this.announcedPairs.values().next().value!)
			}
			this.onAnnounce({ kind: 'pair', names: [names.get(pair.uids[0])!, names.get(pair.uids[1])!], emote: pair.emote, withYou: pair.uids.includes(this.uid) })
		}
	}

	private queueMove(plan: () => Cell[] | null): void {
		this.pendingMove = plan
		if (!this.moveInFlight) {
			void this.sendMove()
		}
	}

	private async sendMove(retried = false): Promise<void> {
		const plan = this.pendingMove
		this.pendingMove = null
		const path = plan?.()
		const own = this.ownMotion()
		if (!path || own === null) {
			return
		}
		const t = this.clock.serverNow()
		const predicted = rerouteVia(own.trajectory, t, path)
		if (predicted !== null) {
			own.update(predicted, t)
		}
		this.moveInFlight = true
		try {
			const result = path.length === 1
				? await this.timed(() => this.api.stop(this.token, this.session))
				: await this.timed(() => this.api.move(this.token, this.session, path))
			this.applyOwn(result.participant)
		} catch (error) {
			if (error instanceof ApiError && error.code === 'PATH_CONFLICT' && !retried) {
				const participant = error.data.participant as Participant | undefined
				if (participant) {
					this.applyOwn(participant, true)
				}
				this.moveInFlight = false
				if (this.pendingMove === null) {
					this.pendingMove = plan
				}
				await this.sendMove(true)
				return
			}
			this.handleCommandError(error)
		} finally {
			this.moveInFlight = false
		}
		if (this.pendingMove !== null) {
			void this.sendMove()
		}
	}

	private async own(command: () => Promise<OwnChange>): Promise<void> {
		if (this.state.status !== 'active') {
			return
		}
		try {
			const result = await this.timed(command)
			this.applyOwn(result.participant)
		} catch (error) {
			this.handleCommandError(error)
		}
	}

	private handleCommandError(error: unknown): void {
		if (error instanceof ApiError && ['RATE_LIMITED', 'OUT_OF_REACH', 'INVALID_INPUT', 'PATH_CONFLICT'].includes(error.code)) {
			this.state.errorCode = error.code
			return
		}
		this.fail(error, false)
	}

	private lead(): number {
		return Math.min(400, this.clock.latency + 80)
	}

	private ownMotion(): Motion | null {
		return this.motions.get(this.uid) ?? null
	}

	// Server state -----------------------------------------------------------

	/**
	 * Applies an event batch from Client Push.
	 */
	handleBatch(batch: EventBatch): void {
		if (batch.office !== this.token || !this.isActive) {
			return
		}
		this.lastPushAt = this.clock.localNow()
		this.pushHealthy = true
		this.missedPushes = 0
		if (batch.rev <= this.state.rev) {
			return
		}
		if (batch.rev !== this.state.rev + 1) {
			this.schedule(0)
			return
		}
		this.state.rev = batch.rev
		for (const event of batch.events) {
			this.applyEvent(event, batch.serverTime)
		}
		this.refreshPeople()
	}

	private applyEvent(event: RoomEvent, serverTime: number): void {
		const now = this.clock.calibrated ? this.clock.serverNow() : serverTime
		switch (event.kind) {
			case 'upsert':
				if (event.participant.uid === this.uid) {
					if (event.participant.generation > this.generation) {
						this.end('taken-over')
						return
					}
					this.applyOwn(event.participant)
				} else {
					const known = this.participants.has(event.participant.uid)
					this.setParticipant(event.participant, now)
					if (!known) {
						this.onAnnounce({ kind: 'enter', name: event.participant.name })
						this.someoneArrived()
					}
				}
				break
			case 'remove':
				if (event.uid === this.uid) {
					this.end(event.reason === 'removed' ? 'removed' : event.reason === 'timeout' ? 'expired' : event.reason === 'left' ? 'left' : event.reason === 'moved' ? 'taken-over' : 'closed')
					return
				}
				{
					const name = this.participants.get(event.uid)?.name
					this.participants.delete(event.uid)
					this.motions.delete(event.uid)
					if (name) {
						this.onAnnounce({ kind: 'leave', name })
					}
				}
				break
			case 'prop':
				this.state.props = [...this.state.props.filter((p) => p.id !== event.prop.id), event.prop]
				break
			case 'config':
				this.state.decor = event.decor
				this.state.title = event.title
				this.state.configRev = event.configRev
				break
			case 'call':
				this.state.call = event.call
				break
			case 'desks':
				this.desksChanged(event.desksRev)
				break
			case 'focus':
				this.setFocus(event.focus)
				break
			case 'closed':
				this.end('closed')
				break
		}
	}

	private applySnapshot(snapshot: Snapshot): void {
		const now = this.clock.serverNow()
		this.state.rev = snapshot.rev
		this.state.title = snapshot.title
		this.state.capacity = snapshot.capacity
		this.state.decor = snapshot.decor
		this.state.props = snapshot.props
		this.state.call = snapshot.call ?? null
		this.state.configRev = snapshot.configRev
		this.desksChanged(snapshot.desksRev)
		if (JSON.stringify(snapshot.focus ?? null) !== JSON.stringify(this.state.focus)) {
			this.setFocus(snapshot.focus ?? null)
		}
		const first = this.state.people.length === 0
		const seen = new Set<string>()
		for (const participant of snapshot.participants) {
			seen.add(participant.uid)
			if (participant.uid === this.uid) {
				if (snapshot.you && participant.generation > snapshot.you.generation) {
					this.end('taken-over')
					return
				}
				this.applyOwn(participant)
			} else {
				if (!this.participants.has(participant.uid) && !first) {
					this.onAnnounce({ kind: 'enter', name: participant.name })
					this.someoneArrived()
				}
				this.setParticipant(participant, now)
			}
		}
		for (const uid of [...this.participants.keys()]) {
			if (!seen.has(uid)) {
				const name = this.participants.get(uid)?.name
				this.participants.delete(uid)
				this.motions.delete(uid)
				if (name && uid !== this.uid) {
					this.onAnnounce({ kind: 'leave', name })
				}
			}
		}
		this.refreshPeople()
	}

	private setParticipant(participant: Participant, now: number): void {
		this.participants.set(participant.uid, participant)
		const motion = this.motions.get(participant.uid)
		if (motion) {
			motion.update(participant.trajectory, now)
		} else {
			this.motions.set(participant.uid, new Motion(participant.trajectory, now, participant.uid === this.uid))
		}
	}

	private applyOwn(participant: Participant, force = false): void {
		const now = this.clock.serverNow()
		const motion = this.motions.get(this.uid)
		if (motion && force) {
			this.motions.set(this.uid, new Motion(participant.trajectory, now, true))
		}
		this.setParticipant(participant, now)
		this.refreshPeople()
	}

	private refreshPeople(): void {
		const people: PersonView[] = []
		for (const participant of this.participants.values()) {
			const trajectory: Trajectory = this.motions.get(participant.uid)?.trajectory ?? participant.trajectory
			people.push({
				uid: participant.uid,
				name: participant.name,
				appearance: participant.appearance,
				mode: participant.mode,
				zone: zoneAt(this.layout, finalCell(trajectory)),
				emote: participant.emote,
				isYou: participant.uid === this.uid,
				note: participant.note ?? null,
				status: this.state.statuses[participant.uid] ?? null,
				birthday: participant.birthday ?? false,
				focusing: this.state.focus?.uids.includes(participant.uid) ?? false,
			})
		}
		people.sort((a, b) => Number(b.isYou) - Number(a.isYou) || a.name.localeCompare(b.name))
		this.state.people = people
		this.announcePairs()
	}

	// Heartbeat and push -----------------------------------------------------

	private startPush(): void {
		if (this.push === null || this.pushListening) {
			return
		}
		this.pushListening = true
		this.state.pushActive = this.push.listen((batch) => this.handleBatch(batch))
		this.pushHealthy = this.state.pushActive
	}

	private interval(): number {
		const pushed = this.state.pushActive && this.pushHealthy
		if (!this.visible) {
			return pushed ? POLL_INTERVAL.hiddenPushed : POLL_INTERVAL.hidden
		}
		return pushed ? POLL_INTERVAL.pushed : POLL_INTERVAL.polling
	}

	private schedule(delay = this.interval()): void {
		if (this.timer !== null) {
			clearTimeout(this.timer)
		}
		if (!this.isActive) {
			return
		}
		this.timer = setTimeout(() => void this.poll(), delay)
	}

	private async poll(): Promise<void> {
		this.timer = null
		if (!this.isActive) {
			return
		}
		const knownRev = this.state.rev
		const pollStartedAt = this.clock.localNow()
		try {
			const result = await this.timed(() => this.api.poll(this.token, this.session, knownRev))
			this.retry = 0
			if (this.state.status === 'reconnecting') {
				this.state.status = 'active'
			}
			if (result.changed) {
				// A change learned by polling while no push arrived lately means pushes are
				// not getting through. The count only resets when a push arrives.
				if (this.state.pushActive && this.pushHealthy && this.lastPushAt < pollStartedAt - PUSH_GRACE_MS) {
					this.missedPushes++
					if (this.missedPushes >= 2) {
						this.pushHealthy = false
					}
				}
				if (result.catalogHash !== this.catalogHash) {
					this.end('outdated')
					return
				}
				this.applySnapshot(result)
			}
			this.schedule()
		} catch (error) {
			this.fail(error, false)
		}
	}

	private fail(error: unknown, entering: boolean): void {
		if (!(error instanceof ApiError)) {
			this.state.errorCode = 'UNKNOWN'
			this.end('error')
			// eslint-disable-next-line no-console -- unexpected programming errors must stay visible
			console.error('Virtual Office session failed', error)
			return
		}
		this.state.errorCode = error.code
		switch (error.code) {
			case 'ACTIVE_ELSEWHERE':
				this.state.sameOffice = Boolean(error.data.sameOffice)
				this.end('elsewhere')
				return
			case 'ROOM_FULL':
				this.end('full')
				return
			case 'OFFICE_REMOVED':
				this.state.removedUntil = Number(error.data.until ?? 0) || null
				this.end('removed')
				return
			case 'TAKEN_OVER':
				this.end('taken-over')
				return
			case 'NOT_PRESENT':
				this.end('expired')
				return
			case 'OFFICE_UNAVAILABLE':
				this.end('closed')
				return
		}
		if (error.retryable || error.code === 'AUDIENCE_UNAVAILABLE') {
			if (entering) {
				this.end('error')
				return
			}
			this.state.status = 'reconnecting'
			const delay = RETRY_DELAYS[Math.min(this.retry, RETRY_DELAYS.length - 1)] * (0.75 + Math.random() * 0.5)
			this.retry++
			this.schedule(delay)
			return
		}
		this.end('error')
	}

	private end(status: RoomStatus): void {
		this.stopTimers()
		this.state.status = status
		if (status !== 'elsewhere' && status !== 'full') {
			this.participants.clear()
			this.motions.clear()
			this.state.people = []
			this.state.props = []
			this.state.rev = -1
			this.state.desks = []
			this.state.statuses = {}
			this.state.focus = null
			this.desksRev = -1
		}
		if (status !== 'elsewhere') {
			this.session = newSession()
		}
	}

	private stopTimers(): void {
		if (this.timer !== null) {
			clearTimeout(this.timer)
			this.timer = null
		}
		this.cancelInteract()
		if (this.deskTimer !== null) {
			clearTimeout(this.deskTimer)
			this.deskTimer = null
		}
		if (this.focusTimer !== null) {
			clearTimeout(this.focusTimer)
			this.focusTimer = null
		}
		this.heldDirection = null
		this.pendingMove = null
	}

	private async timed<T extends { serverTime: number }>(call: () => Promise<T>): Promise<T> {
		const sentAt = this.clock.localNow()
		const result = await call()
		this.clock.observe(sentAt, this.clock.localNow(), result.serverTime)
		return result
	}
}

function roundCell(cell: Cell): Cell {
	return [Math.round(cell[0]), Math.round(cell[1])]
}

function standingSpots(layout: Layout, center: Cell, radius: number): Cell[] {
	const [px, py] = center
	const spots: Cell[] = []
	for (let dy = -2; dy <= 2; dy++) {
		for (let dx = -2; dx <= 2; dx++) {
			const cell: Cell = [px + dx, py + dy]
			if ((dx !== 0 || dy !== 0) && Math.hypot(dx, dy) <= radius
				&& layout.collision[cell[1]]?.[cell[0]] === '.') {
				spots.push(cell)
			}
		}
	}
	return spots
}
