import type { Cell } from '../../shared/catalog.ts'
/**
 * SPDX-FileCopyrightText: 2026 Hoang Pham
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
import type { RoomApi } from '../../src/session/room.ts'
import type { EventBatch, Participant, Snapshot } from '../../src/types.ts'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { reroute, stationary } from '../../shared/movement.ts'
import { ApiError } from '../../src/api.ts'
import { Motion } from '../../src/scene/motion.ts'
import { ServerClock } from '../../src/session/clock.ts'
import { POLL_INTERVAL, RoomSession } from '../../src/session/room.ts'

vi.mock('@nextcloud/axios', () => ({ default: {}, isAxiosError: () => false }))
vi.mock('@nextcloud/router', () => ({ generateOcsUrl: (p: string) => p }))

const HASH = 'catalog-hash'

function pushInto(capture: (handler: (batch: EventBatch) => void) => void) {
	return {
		listen: (handler: (batch: EventBatch) => void) => {
			capture(handler)
			return true
		},
	}
}
const TOKEN = 'a'.repeat(32)

function person(uid: string, cell: Cell, extra: Partial<Participant> = {}): Participant {
	return {
		uid,
		name: uid.toUpperCase(),
		appearance: { creature: 'rabbit', palette: 'sage', accessory: 'none' },
		mode: 'available',
		trajectory: stationary(cell, Date.now()),
		emote: null,
		generation: 1,
		enteredAt: 0,
		note: null,
		birthday: false,
		...extra,
	}
}

function snapshot(rev: number, participants: Participant[], extra: Partial<Snapshot> = {}): Snapshot {
	return {
		office: TOKEN,
		rev,
		serverTime: Date.now(),
		configRev: 1,
		title: 'Studio',
		layoutId: 'starter-office-v1',
		catalogHash: HASH,
		capacity: 32,
		decor: {},
		participants,
		props: [],
		call: null,
		desksRev: 0,
		focus: null,
		you: { session: 'x', generation: 1 },
		...extra,
	}
}

function fakeApi(overrides: Partial<RoomApi> = {}): RoomApi & { calls: string[] } {
	const calls: string[] = []
	const own = (p: Participant) => ({ rev: 3, serverTime: Date.now(), participant: p })
	return {
		calls,
		enter: vi.fn(async () => {
			calls.push('enter')
			return snapshot(1, [person('alice', [5, 17]), person('bao', [4, 17])])
		}),
		poll: vi.fn(async (_t, _s, rev) => {
			calls.push('poll')
			return { changed: false as const, rev, serverTime: Date.now() }
		}),
		move: vi.fn(async (_t, _s, path: Cell[]) => {
			calls.push('move')
			return own(person('alice', path[0], { trajectory: reroute(stationary(path[0], Date.now()), Date.now(), path) }))
		}),
		stop: vi.fn(async () => own(person('alice', [5, 17]))),
		emote: vi.fn(async () => own(person('alice', [5, 17]))),
		mode: vi.fn(async (_t, _s, mode: string) => own(person('alice', [5, 17], { mode }))),
		profile: vi.fn(async () => own(person('alice', [5, 17]))),
		interact: vi.fn(async () => ({ outcome: 'started', serverTime: Date.now() })),
		startMusic: vi.fn(async () => ({ music: { uid: 'alice', name: 'ALICE', startedAt: Date.now(), tracks: [{ title: 'Song', durationMs: 60_000 }] }, serverTime: Date.now() })),
		stopMusic: vi.fn(async () => ({ music: null, serverTime: Date.now() })),
		voice: vi.fn(async (_t, _s, on: boolean) => own(person('alice', [5, 17], { voice: on ? 'x' : null }))),
		signal: vi.fn(async () => ({ id: 1, serverTime: Date.now() })),
		leave: vi.fn(async () => {
			calls.push('leave')
			return []
		}),
		desks: vi.fn(async () => {
			calls.push('desks')
			return { desks: [], statuses: {}, times: {} }
		}),
		claimDesk: vi.fn(async () => ({ desks: [{ deskId: 'd1', uid: 'alice', name: 'ALICE', note: null, birthday: false }], statuses: {}, times: {} })),
		focus: vi.fn(async (_t, _s, minutes: number) => ({ focus: { startedAt: Date.now(), endsAt: Date.now() + minutes * 60_000, minutes, uids: ['alice'] }, serverTime: Date.now() })),
		leaveFocus: vi.fn(async () => ({ focus: null, serverTime: Date.now() })),
		releaseDesk: vi.fn(async () => ({ desks: [], statuses: {}, times: {} })),
		...overrides,
	}
}

describe('RoomSession', () => {
	beforeEach(() => {
		vi.useFakeTimers()
		vi.stubGlobal('crypto', globalThis.crypto)
	})
	afterEach(() => {
		vi.useRealTimers()
	})

	it('enters, shows people and polls while nobody pushes', async () => {
		const api = fakeApi()
		const session = new RoomSession(TOKEN, 'alice', api, null, HASH, 'starter-office-v1')
		await session.enter()
		expect(session.state.status).toBe('active')
		expect(session.state.people.map((p) => p.uid)).toEqual(['alice', 'bao'])
		expect(session.state.people[0].isYou).toBe(true)
		await vi.advanceTimersByTimeAsync(POLL_INTERVAL.polling * 3 + 10)
		expect(api.calls.filter((c) => c === 'poll').length).toBe(3)
	})

	it('refuses an outdated catalog and leaves again', async () => {
		const api = fakeApi({ enter: vi.fn(async () => snapshot(1, [person('alice', [5, 17])], { catalogHash: 'other' })) })
		const session = new RoomSession(TOKEN, 'alice', api, null, HASH, 'starter-office-v1')
		await session.enter()
		expect(session.state.status).toBe('outdated')
		expect(api.leave).toHaveBeenCalled()
	})

	it('turns voice on, and stays in the office when an admin just turned voice off', async () => {
		const api = fakeApi()
		const session = new RoomSession(TOKEN, 'alice', api, null, HASH, 'starter-office-v1')
		await session.enter()
		await session.setVoice(true)
		expect(session.state.people.find((p) => p.isYou)?.voice).toBe('x')
		api.voice = vi.fn(async () => {
			throw new ApiError(403, 'ACTION_DENIED', 'denied')
		})
		await session.setVoice(true)
		expect(session.state.status).toBe('active')
		expect(session.state.voiceAllowed).toBe(false)
	})

	it('hands voice signals from the poll over after the snapshot', async () => {
		const order: string[] = []
		const api = fakeApi({
			poll: vi.fn(async () => ({ changed: true as const, ...snapshot(2, [person('alice', [5, 17]), person('bao', [4, 17], { voice: 'b'.repeat(32) })]), signals: [{ id: 1, from: 'b'.repeat(32), body: { type: 'offer' as const, sdp: 'v=0' } }] })),
		})
		const session = new RoomSession(TOKEN, 'alice', api, null, HASH, 'starter-office-v1')
		session.onSignals = (signals) => order.push(`signals ${signals.length}, bao has voice: ${session.state.people.find((p) => p.uid === 'bao')?.voice !== null}`)
		await session.enter()
		await vi.advanceTimersByTimeAsync(POLL_INTERVAL.polling + 10)
		expect(order).toEqual(['signals 1, bao has voice: true'])
	})

	it('asks to reload when the office switched to another layout', async () => {
		const api = fakeApi({ enter: vi.fn(async () => snapshot(1, [person('alice', [5, 17])], { layoutId: 'compact-office-v1' })) })
		const session = new RoomSession(TOKEN, 'alice', api, null, HASH, 'starter-office-v1')
		await session.enter()
		expect(session.state.status).toBe('outdated')
		expect(api.leave).toHaveBeenCalled()

		const later = fakeApi({
			poll: vi.fn(async () => ({ changed: true as const, ...snapshot(2, [person('alice', [5, 17])], { layoutId: 'compact-office-v1' }) })),
		})
		const inside = new RoomSession(TOKEN, 'alice', later, null, HASH, 'starter-office-v1')
		await inside.enter()
		expect(inside.state.status).toBe('active')
		await vi.advanceTimersByTimeAsync(POLL_INTERVAL.polling + 10)
		expect(inside.state.status).toBe('outdated')
	})

	it.each([
		['ACTIVE_ELSEWHERE', 409, 'elsewhere'],
		['ROOM_FULL', 409, 'full'],
		['OFFICE_REMOVED', 403, 'removed'],
		['OFFICE_UNAVAILABLE', 404, 'closed'],
	])('maps %s on entry to %s', async (code, status, expected) => {
		const api = fakeApi({ enter: vi.fn(async () => {
			throw new ApiError(status, code, code, { until: 5, sameOffice: true })
		}) })
		const session = new RoomSession(TOKEN, 'alice', api, null, HASH, 'starter-office-v1')
		await session.enter()
		expect(session.state.status).toBe(expected)
	})

	it('applies pushed batches in order and resyncs on a gap', async () => {
		let handler: ((b: EventBatch) => void) | null = null
		const api = fakeApi()
		const session = new RoomSession(TOKEN, 'alice', api, pushInto((h) => {
			handler = h
		}), HASH, 'starter-office-v1')
		await session.enter()
		expect(session.state.pushActive).toBe(true)
		handler!({ office: TOKEN, rev: 2, serverTime: Date.now(), events: [{ kind: 'upsert', participant: person('chi', [6, 17]) }] })
		expect(session.state.people.map((p) => p.uid)).toContain('chi')
		handler!({ office: TOKEN, rev: 2, serverTime: Date.now(), events: [{ kind: 'remove', uid: 'chi', reason: 'left' }] })
		expect(session.state.people.map((p) => p.uid)).toContain('chi')
		handler!({ office: 'other', rev: 3, serverTime: Date.now(), events: [{ kind: 'remove', uid: 'chi', reason: 'left' }] })
		expect(session.state.people.map((p) => p.uid)).toContain('chi')
		const polls = api.calls.filter((c) => c === 'poll').length
		handler!({ office: TOKEN, rev: 9, serverTime: Date.now(), events: [] })
		expect(session.state.rev).toBe(2)
		await vi.advanceTimersByTimeAsync(1)
		expect(api.calls.filter((c) => c === 'poll').length).toBe(polls + 1)
	})

	it('uses a slow heartbeat with push and falls back to polling when pushes stop arriving', async () => {
		let rev = 1
		const api = fakeApi({
			poll: vi.fn(async () => {
				rev += 2
				return { changed: true as const, ...snapshot(rev, [person('alice', [5, 17])]) }
			}),
		})
		const session = new RoomSession(TOKEN, 'alice', api, { listen: () => true }, HASH, 'starter-office-v1')
		await session.enter()
		const count = () => (api.poll as ReturnType<typeof vi.fn>).mock.calls.length
		await vi.advanceTimersByTimeAsync(POLL_INTERVAL.pushed - 100)
		expect(count()).toBe(0)
		// Two heartbeats that each reveal missed pushes...
		await vi.advanceTimersByTimeAsync(POLL_INTERVAL.pushed + 200)
		expect(count()).toBe(2)
		// ...switch the session to fast polling.
		await vi.advanceTimersByTimeAsync(POLL_INTERVAL.polling * 3)
		expect(count()).toBe(5)
	})

	it('notices dead pushes even when each heartbeat sees only one change', async () => {
		let rev = 1
		const api = fakeApi({
			poll: vi.fn(async () => {
				rev += 1
				return { changed: true as const, ...snapshot(rev, [person('alice', [5, 17])]) }
			}),
		})
		const session = new RoomSession(TOKEN, 'alice', api, { listen: () => true }, HASH, 'starter-office-v1')
		await session.enter()
		const count = () => (api.poll as ReturnType<typeof vi.fn>).mock.calls.length
		await vi.advanceTimersByTimeAsync(POLL_INTERVAL.pushed * 2 + 100)
		expect(count()).toBe(2)
		await vi.advanceTimersByTimeAsync(POLL_INTERVAL.polling * 3)
		expect(count()).toBe(5)
	})

	it('keeps the slow heartbeat while pushes arrive', async () => {
		let handler: ((b: EventBatch) => void) | null = null
		let rev = 1
		const api = fakeApi({
			poll: vi.fn(async (_t, _s, known) => ({ changed: false as const, rev: known, serverTime: Date.now() })),
		})
		const session = new RoomSession(TOKEN, 'alice', api, pushInto((h) => {
			handler = h
		}), HASH, 'starter-office-v1')
		await session.enter()
		for (let i = 0; i < 4; i++) {
			await vi.advanceTimersByTimeAsync(2000)
			rev += 1
			handler!({ office: TOKEN, rev, serverTime: Date.now(), events: [] })
		}
		expect((api.poll as ReturnType<typeof vi.fn>).mock.calls.length).toBeLessThanOrEqual(2)
	})

	it('ends when another window takes over', async () => {
		let handler: ((b: EventBatch) => void) | null = null
		const session = new RoomSession(TOKEN, 'alice', fakeApi(), pushInto((h) => {
			handler = h
		}), HASH, 'starter-office-v1')
		await session.enter()
		handler!({ office: TOKEN, rev: 2, serverTime: Date.now(), events: [{ kind: 'upsert', participant: person('alice', [5, 17], { generation: 2 }) }] })
		expect(session.state.status).toBe('taken-over')
		expect(session.state.people).toEqual([])
	})

	it.each([
		['removed', 'removed'],
		['timeout', 'expired'],
		['access', 'closed'],
	])('ends when the server removes you (%s)', async (reason, expected) => {
		let handler: ((b: EventBatch) => void) | null = null
		const api = fakeApi()
		const session = new RoomSession(TOKEN, 'alice', api, pushInto((h) => {
			handler = h
		}), HASH, 'starter-office-v1')
		await session.enter()
		handler!({ office: TOKEN, rev: 2, serverTime: Date.now(), events: [{ kind: 'remove', uid: 'alice', reason }] })
		expect(session.state.status).toBe(expected)
		const polls = api.calls.length
		await vi.advanceTimersByTimeAsync(60_000)
		expect(api.calls.length).toBe(polls)
	})

	it('retries with backoff on network errors and stops after leaving', async () => {
		let fail = true
		const api = fakeApi({
			poll: vi.fn(async (_t, _s, rev) => {
				if (fail) {
					throw new ApiError(0, 'NETWORK', 'offline')
				}
				return { changed: false as const, rev, serverTime: Date.now() }
			}),
		})
		const session = new RoomSession(TOKEN, 'alice', api, null, HASH, 'starter-office-v1')
		await session.enter()
		await vi.advanceTimersByTimeAsync(POLL_INTERVAL.polling + 10)
		expect(session.state.status).toBe('reconnecting')
		fail = false
		await vi.advanceTimersByTimeAsync(2000)
		expect(session.state.status).toBe('active')
		await session.leave()
		expect(session.state.status).toBe('left')
		const calls = (api.poll as ReturnType<typeof vi.fn>).mock.calls.length
		await vi.advanceTimersByTimeAsync(30_000)
		expect((api.poll as ReturnType<typeof vi.fn>).mock.calls.length).toBe(calls)
	})

	it('predicts a walk locally, sends the path and retries once after a conflict', async () => {
		let conflicts = 1
		const api = fakeApi()
		const move = api.move
		api.move = vi.fn(async (t, s, path) => {
			if (conflicts-- > 0) {
				throw new ApiError(409, 'PATH_CONFLICT', 'moved', { participant: person('alice', [5, 16]), serverTime: Date.now() })
			}
			return move(t, s, path)
		})
		const session = new RoomSession(TOKEN, 'alice', api, null, HASH, 'starter-office-v1')
		await session.enter()
		expect(session.walkTo([5, 13])).toBe(true)
		await vi.advanceTimersByTimeAsync(1)
		const paths = (api.move as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[2])
		expect(paths).toHaveLength(2)
		expect(paths[0][0]).toEqual([5, 17])
		expect(paths[1][0]).toEqual([5, 16])
		expect(paths[1].at(-1)).toEqual([5, 13])
	})

	it('rejects unreachable targets without calling the server', async () => {
		const api = fakeApi()
		const session = new RoomSession(TOKEN, 'alice', api, null, HASH, 'starter-office-v1')
		await session.enter()
		expect(session.walkTo([16, 10])).toBe(false)
		expect(api.move).not.toHaveBeenCalled()
	})

	it('keeps rate limits as feedback instead of ending the visit', async () => {
		const api = fakeApi({ emote: vi.fn(async () => {
			throw new ApiError(429, 'RATE_LIMITED', 'slow')
		}) })
		const session = new RoomSession(TOKEN, 'alice', api, null, HASH, 'starter-office-v1')
		await session.enter()
		await session.emote('wave')
		expect(session.state.status).toBe('active')
		expect(session.state.errorCode).toBe('RATE_LIMITED')
	})
})

describe('Motion', () => {
	it('replays a late remote walk from its start', () => {
		const walk = reroute(stationary([5, 5], 1000), 1000, [[5, 5], [6, 5], [7, 5]])
		const motion = new Motion(stationary([5, 5], 0), 1000)
		motion.update(walk, 1600)
		expect(motion.displayLag).toBe(600)
		expect(motion.sample(1600).position).toEqual([5, 5])
		expect(motion.sample(1725).position).toEqual([5.5, 5])
		expect(motion.sample(2200).position).toEqual([7, 5])
	})

	it('shows very late walks at their current position', () => {
		const walk = reroute(stationary([5, 5], 1000), 1000, [[5, 5], [6, 5]])
		const motion = new Motion(stationary([5, 5], 0), 1000)
		motion.update(walk, 10_000)
		expect(motion.displayLag).toBe(0)
		expect(motion.sample(10_000).position).toEqual([6, 5])
	})

	it('queues a reroute until the replay reaches it and never goes back in id', () => {
		const first = reroute(stationary([5, 5], 1000), 1000, [[5, 5], [6, 5], [7, 5], [8, 5]])
		const motion = new Motion(stationary([5, 5], 0), 1000)
		motion.update(first, 1500)
		const second = reroute(first, 1300, [[7, 5], [7, 6]])
		motion.update(second, 1600)
		expect(motion.trajectory).toBe(second)
		motion.update(first, 1700)
		expect(motion.trajectory).toBe(second)
		const at = motion.sample(1300 + 500 + 1)
		expect(at.position[0]).toBeCloseTo(6.2, 1)
	})

	it('shows your own moves immediately', () => {
		const walk = reroute(stationary([5, 5], 1000), 1000, [[5, 5], [6, 5]])
		const motion = new Motion(stationary([5, 5], 0), 1000, true)
		motion.update(walk, 1125)
		expect(motion.displayLag).toBe(0)
		expect(motion.sample(1250 + 200).position).toEqual([6, 5])
	})
})

describe('ServerClock', () => {
	it('prefers fast round trips', () => {
		let now = 0
		const clock = new ServerClock(() => now)
		clock.observe(0, 100, 10_050)
		clock.observe(200, 1200, 11_000)
		expect(clock.latency).toBe(50)
		now = 2000
		expect(Math.abs(clock.serverNow() - 12_000)).toBeLessThan(200)
	})
})

describe('walking into a zone', () => {
	it('picks a free cell beside people near the anchor instead of stacking them', async () => {
		vi.useFakeTimers()
		const layoutAnchor: Cell = [16, 13]
		const api = fakeApi({ enter: vi.fn(async () => snapshot(1, [person('alice', [5, 17]), person('bao', layoutAnchor)])) })
		const session = new RoomSession(TOKEN, 'alice', api, null, HASH, 'starter-office-v1')
		await session.enter()
		expect(session.walkToZone('common')).toBe(true)
		await vi.advanceTimersByTimeAsync(1)
		const path = (api.move as ReturnType<typeof vi.fn>).mock.calls[0][2] as Cell[]
		const target = path.at(-1)!
		expect(target).not.toEqual(layoutAnchor)
		// Close to Bảo with two free cells between, so the name tags do not overlap.
		expect(Math.max(Math.abs(target[0] - 16), Math.abs(target[1] - 13))).toBe(3)
		expect(session.walkToZone('nowhere')).toBe(false)
		vi.useRealTimers()
	})
})

describe('using a prop', () => {
	it('stands beside someone already at the prop, not on their spot', async () => {
		vi.useFakeTimers()
		const api = fakeApi({ enter: vi.fn(async () => snapshot(1, [person('alice', [5, 17]), person('bao', [3, 2])])) })
		const session = new RoomSession(TOKEN, 'alice', api, null, HASH, 'starter-office-v1')
		await session.enter()
		expect(session.useProp('coffee')).toBe('walking')
		await vi.advanceTimersByTimeAsync(1)
		const path = (api.move as ReturnType<typeof vi.fn>).mock.calls[0][2] as Cell[]
		expect(path.at(-1)).not.toEqual([3, 2])
		vi.useRealTimers()
	})
})

describe('late effects', () => {
	it('plays a reaction that arrived late for its full length', async () => {
		vi.useFakeTimers()
		const session = new RoomSession(TOKEN, 'alice', fakeApi(), null, HASH, 'starter-office-v1')
		const effect = { startedAt: 10_000, endsAt: 12_000 }
		expect(session.isShowing('prop:coffee:10000', effect, 11_500)).toBe(true)
		expect(session.isShowing('prop:coffee:10000', effect, 13_000)).toBe(true)
		expect(session.isShowing('prop:coffee:10000', effect, 13_600)).toBe(false)
		const old = { startedAt: 0, endsAt: 2000 }
		expect(session.isShowing('prop:plant:0', old, 20_000)).toBe(false)
		vi.useRealTimers()
	})
})

describe('people together', () => {
	beforeEach(() => {
		vi.useFakeTimers()
		vi.stubGlobal('crypto', globalThis.crypto)
	})
	afterEach(() => {
		vi.useRealTimers()
	})

	it('announces two people reacting together once', async () => {
		const announced: unknown[] = []
		let push: (batch: EventBatch) => void = () => {}
		const api = fakeApi({ emote: vi.fn(async () => ({ rev: 2, serverTime: Date.now(), participant: person('alice', [5, 17], { emote: { id: 'wave', startedAt: Date.now(), endsAt: Date.now() + 4000 } }) })) })
		const session = new RoomSession(TOKEN, 'alice', api, pushInto((h) => {
			push = h
		}), HASH, 'starter-office-v1', (a) => announced.push(a))
		await session.enter()
		await session.emote('wave')
		push({ office: TOKEN, rev: 2, serverTime: Date.now(), events: [{ kind: 'upsert', participant: person('bao', [4, 17], { emote: { id: 'wave', startedAt: Date.now(), endsAt: Date.now() + 4000 } }) }] })
		push({ office: TOKEN, rev: 3, serverTime: Date.now(), events: [{ kind: 'upsert', participant: person('bao', [4, 17], { emote: { id: 'wave', startedAt: Date.now(), endsAt: Date.now() + 4000 } }) }] })
		expect(announced).toEqual([{ kind: 'pair', names: ['ALICE', 'BAO'], emote: 'wave', withYou: true }])
		expect(session.pairs().map((p) => p.uids)).toEqual([['alice', 'bao']])
		session.dispose()
	})

	it('keeps desks and statuses fresh without polling them on every change', async () => {
		let push: (batch: EventBatch) => void = () => {}
		const api = fakeApi({ desks: vi.fn(async () => {
			api.calls.push('desks')
			return { desks: [{ deskId: 'd3', uid: 'chi', name: 'CHI', note: 'Writing the report', birthday: false }], statuses: { bao: { status: 'away' as const, message: null, icon: null, clearAt: null } }, times: {} }
		}) })
		const session = new RoomSession(TOKEN, 'alice', api, pushInto((h) => {
			push = h
		}), HASH, 'starter-office-v1')
		await session.enter()
		await vi.advanceTimersByTimeAsync(0)
		const desks = () => api.calls.filter((c) => c === 'desks').length
		expect(desks()).toBe(1)
		expect(session.state.desks[0].note).toBe('Writing the report')
		expect(session.state.people.find((p) => p.uid === 'bao')?.status?.status).toBe('away')

		// A claim elsewhere arrives as an event and is fetched at once.
		push({ office: TOKEN, rev: 2, serverTime: Date.now(), events: [{ kind: 'desks', desksRev: 1 }] })
		await vi.advanceTimersByTimeAsync(0)
		expect(desks()).toBe(2)
		// Arrivals in a burst lead to one fetch a few seconds later.
		push({ office: TOKEN, rev: 3, serverTime: Date.now(), events: [{ kind: 'upsert', participant: person('chi', [6, 17]) }, { kind: 'upsert', participant: person('dan', [7, 17]) }] })
		await vi.advanceTimersByTimeAsync(4000)
		expect(desks()).toBe(2)
		await vi.advanceTimersByTimeAsync(1100)
		expect(desks()).toBe(3)
		await vi.advanceTimersByTimeAsync(60_000)
		expect(desks()).toBe(4)
		await session.claimDesk('d1')
		expect(session.state.desks.map((d) => d.uid)).toEqual(['alice'])
		session.dispose()
	})

	it('shows the focus session and tells its members when it is done', async () => {
		const announced: unknown[] = []
		const api = fakeApi()
		const session = new RoomSession(TOKEN, 'alice', api, null, HASH, 'starter-office-v1', (a) => announced.push(a))
		await session.enter()
		await session.startFocus(25)
		expect(session.state.people.find((p) => p.uid === 'alice')?.focusing).toBe(true)
		// Starting a session walks you to the focus desks.
		await vi.advanceTimersByTimeAsync(100)
		expect(api.move).toHaveBeenCalled()
		expect(session.state.people.find((p) => p.uid === 'alice')?.zone).toBe('focus')
		expect(session.state.people.find((p) => p.uid === 'bao')?.focusing).toBe(false)
		await vi.advanceTimersByTimeAsync(25 * 60_000 + 10)
		expect(session.state.focus).toBeNull()
		expect(announced).toContainEqual({ kind: 'focus-done', minutes: 25 })
		session.dispose()
	})

	it('retries a prop once when the server has not seen the last step yet', async () => {
		let calls = 0
		const api = fakeApi({ interact: vi.fn(async () => {
			calls++
			if (calls === 1) {
				throw new ApiError(422, 'OUT_OF_REACH', 'Walk closer first')
			}
			return { outcome: 'started', serverTime: Date.now() }
		}) })
		const session = new RoomSession(TOKEN, 'alice', api, null, HASH, 'starter-office-v1')
		await session.enter()
		expect(session.useProp('coffee')).toBe('walking')
		await vi.advanceTimersByTimeAsync(10_000)
		expect(calls).toBe(2)
		expect(session.state.errorCode).toBe('')
		session.dispose()
	})
})
