/**
 * SPDX-FileCopyrightText: 2026 Hoang Pham
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
import type { Cell } from '../../shared/catalog.ts'

import { expect, test } from '@playwright/test'
import { getLayout } from '../../shared/catalog.ts'
import { findPath } from '../../shared/movement.ts'
import { Api, clearPresence, createTeam, occ, removeFromTeam, session, sql, toneWav, uniqueName, upload, waitFor } from './helpers.ts'

let alice: Api, bao: Api, chi: Api, admin: Api, disabled: Api
let teamId: string

test.beforeAll(async () => {
	sql('DELETE FROM oc_vo_presence; DELETE FROM oc_vo_offices')
	;[alice, bao, chi, admin, disabled] = await Promise.all(['alice', 'bao', 'chi', 'vo_admin', 'disabled'].map((u) => Api.as(u)))
	teamId = createTeam('alice', uniqueName('API Team'), ['bao'])
	await admin.call('PUT', '/admin/settings', { roomCapacity: 32 })
})

test.beforeEach(() => clearPresence())

async function teamOffice(title = uniqueName('Office')) {
	const created = await alice.call('POST', '/offices', { title, audience: { kind: 'team', id: teamId } })
	expect(created.status).toBe(201)
	return created.data
}

async function enter(api: Api, token: string, s = session(), takeover = false) {
	const result = await api.call('POST', `/offices/${token}/room/enter`, { session: s, takeover })
	return { ...result, session: s }
}

test.describe('offices and access', () => {
	test('only the audience finds and reads a Team office', async () => {
		const office = await teamOffice()
		expect(office.permissions).toEqual({ isMember: true, canEnter: true, canManage: true })
		expect((await bao.call('GET', `/offices?search=${encodeURIComponent(office.title)}`)).data.map((o: any) => o.token)).toEqual([office.token])
		expect((await bao.call('GET', `/offices/${office.token}`)).data.permissions.canManage).toBe(false)
		for (const outsider of [chi, disabled]) {
			expect((await outsider.call('GET', '/offices')).data?.map?.((o: any) => o.token) ?? []).not.toContain(office.token)
			const read = await outsider.call('GET', `/offices/${office.token}`)
			expect([401, 404]).toContain(read.status)
		}
		expect((await chi.call('GET', `/offices/${office.token}`)).data.code).toBe('OFFICE_UNAVAILABLE')
		expect((await chi.call('GET', `/offices/${'0'.repeat(32)}`)).data.code).toBe('OFFICE_UNAVAILABLE')
		expect((await chi.call('GET', `/offices/${office.token}/card`)).status).toBe(404)
		expect((await enter(chi, office.token)).status).toBe(404)
	})

	test('admins manage offices outside their audience but cannot enter them', async () => {
		const office = await teamOffice()
		const read = await admin.call('GET', `/offices/${office.token}`)
		expect(read.status).toBe(200)
		expect(read.data.permissions).toMatchObject({ isMember: false, canEnter: false, canManage: true })
		expect((await enter(admin, office.token)).status).toBe(404)
		expect((await admin.call('GET', '/admin/offices')).data.map((o: any) => o.token)).toContain(office.token)
		expect((await alice.call('GET', '/admin/settings')).status).toBe(403)
	})

	test('only Team members can create Team offices; groups need an admin', async () => {
		expect((await chi.call('POST', '/offices', { title: 'Nope', audience: { kind: 'team', id: teamId } })).status).toBe(403)
		expect((await alice.call('POST', '/offices', { title: 'Nope', audience: { kind: 'group', id: 'virtualoffice-fixture' } })).status).toBe(403)
		expect((await admin.call('POST', '/offices', { title: 'Missing manager', audience: { kind: 'group', id: 'virtualoffice-fixture' } })).status).toBe(422)
		expect((await admin.call('POST', '/offices', { title: 'Outsider', audience: { kind: 'group', id: 'virtualoffice-fixture' }, managerUid: 'chi' })).status).toBe(422)
		const group = await admin.call('POST', '/offices', { title: uniqueName('Group office'), audience: { kind: 'group', id: 'virtualoffice-fixture' }, managerUid: 'alice' })
		expect(group.status).toBe(201)
		expect((await alice.call('GET', `/offices/${group.data.token}`)).data.permissions.canManage).toBe(true)
		expect((await alice.call('POST', '/offices', { title: ' ', audience: { kind: 'team', id: teamId } })).status).toBe(422)
		expect((await alice.call('POST', '/offices', { title: 'x'.repeat(121), audience: { kind: 'team', id: teamId } })).status).toBe(422)
	})

	test('instance offices follow the admin switch', async () => {
		await admin.call('PUT', '/admin/settings', { instanceOffices: false })
		expect((await admin.call('POST', '/offices', { title: 'All', audience: { kind: 'instance', id: 'instance' }, managerUid: 'alice' })).status).toBe(403)
		await admin.call('PUT', '/admin/settings', { instanceOffices: true })
		const office = await admin.call('POST', '/offices', { title: uniqueName('Everyone'), audience: { kind: 'instance', id: 'instance' }, managerUid: 'alice' })
		expect(office.status).toBe(201)
		expect((await chi.call('GET', `/offices/${office.data.token}`)).status).toBe(200)
		await admin.call('PUT', '/admin/settings', { instanceOffices: false })
		expect((await chi.call('GET', `/offices/${office.data.token}`)).status).toBe(404)
	})

	test('edits use revisions and only allowed fields', async () => {
		const office = await teamOffice()
		const t = office.token
		expect((await alice.call('PATCH', `/offices/${t}`, { title: 'Renamed' })).status).toBe(428)
		const renamed = await alice.call('PATCH', `/offices/${t}`, { title: 'Renamed', decor: { rug: 'ocean' } }, { 'If-Match': '"1"' })
		expect(renamed.status).toBe(200)
		expect(renamed.data.revision).toBe(2)
		expect(renamed.data.config.decor.rug).toBe('ocean')
		expect((await alice.call('PATCH', `/offices/${t}`, { title: 'Lost update' }, { 'If-Match': '"1"' })).status).toBe(412)
		expect((await alice.call('PATCH', `/offices/${t}`, { decor: { rug: 'lava' } }, { 'If-Match': '"2"' })).status).toBe(422)
		expect((await alice.call('PATCH', `/offices/${t}`, { audience: { kind: 'group', id: 'admin' } }, { 'If-Match': '"2"' })).status).toBe(422)
		expect((await bao.call('PATCH', `/offices/${t}`, { title: 'Hijack' }, { 'If-Match': '"2"' })).status).toBe(403)
		expect((await bao.call('DELETE', `/offices/${t}`, undefined, { 'If-Match': '"2"' })).status).toBe(403)
	})

	test('managers must belong to the audience and one must stay', async () => {
		const office = await teamOffice()
		expect((await alice.call('PUT', `/offices/${office.token}/managers`, { uid: 'chi' })).status).toBe(422)
		expect((await alice.call('DELETE', `/offices/${office.token}/managers`, { uid: 'alice' })).data.code).toBe('LAST_MANAGER')
		const added = await alice.call('PUT', `/offices/${office.token}/managers`, { uid: 'bao' })
		expect(added.data.managers.map((m: any) => m.uid)).toEqual(['alice', 'bao'])
		expect((await bao.call('GET', `/offices/${office.token}`)).data.permissions.canManage).toBe(true)
		expect((await alice.call('DELETE', `/offices/${office.token}/managers`, { uid: 'bao' })).status).toBe(200)
		const people = await alice.call('GET', `/offices/${office.token}/people?search=b`)
		expect(people.data.map((p: any) => p.uid)).toContain('bao')
		expect(people.data.map((p: any) => p.uid)).not.toContain('chi')
	})

	test('summaries leave out offices the caller cannot see', async () => {
		const office = await teamOffice()
		await enter(bao, office.token)
		expect((await alice.call('POST', '/summaries', { tokens: [office.token] })).data).toEqual([expect.objectContaining({ token: office.token, count: 1 })])
		expect((await chi.call('POST', '/summaries', { tokens: [office.token] })).data).toEqual([])
		expect((await alice.call('POST', '/summaries', { tokens: Array(51).fill(office.token) })).status).toBe(422)
	})

	test('preferences are validated and versioned', async () => {
		await alice.call('DELETE', '/me/preferences')
		const prefs = { appearance: { creature: 'cat', palette: 'rose', accessory: 'scarf' }, ui: { view: 'list', reducedEffects: true, announcements: true } }
		expect((await alice.call('GET', '/me/preferences')).data).toEqual({ revision: 0, preferences: null })
		expect((await alice.call('PUT', '/me/preferences', { revision: 0, preferences: prefs })).data.revision).toBe(1)
		expect((await alice.call('PUT', '/me/preferences', { revision: 0, preferences: prefs })).status).toBe(412)
		expect((await alice.call('PUT', '/me/preferences', { revision: 1, preferences: { ...prefs, appearance: { creature: 'dragon', palette: 'rose', accessory: 'none' } } })).status).toBe(422)
		const office = await teamOffice()
		const entered = await enter(alice, office.token)
		expect(entered.data.participants[0].appearance).toEqual(prefs.appearance)
		await alice.call('DELETE', '/me/preferences')
	})
})

test.describe('room', () => {
	test('capacity holds under 33 simultaneous entries', async () => {
		// Signing in 33 new accounts for the first time is slow on a busy machine.
		test.setTimeout(240_000)
		const users = Array.from({ length: 33 }, (_, i) => `load${String(i + 1).padStart(2, '0')}`)
		const office = await admin.call('POST', '/offices', { title: uniqueName('Load office'), audience: { kind: 'group', id: 'virtualoffice-load' }, managerUid: 'load01' })
		const apis = await Promise.all(users.map((u) => Api.as(u)))
		// First sign-in copies skeleton files, so complete it before testing room capacity.
		for (const api of apis) {
			expect((await api.call('GET', '/offices')).status).toBe(200)
		}
		const results = await Promise.all(apis.map((api) => enter(api, office.data.token)))
		const statuses = results.map((r) => r.status)
		expect(statuses.filter((s) => s === 200)).toHaveLength(32)
		expect(results.filter((r) => r.data.code === 'ROOM_FULL')).toHaveLength(1)
		expect(Number(sql(`SELECT count(*) FROM oc_vo_presence p JOIN oc_vo_offices o ON o.id = p.office_id WHERE o.token = '${office.data.token}'`))).toBe(32)
		const slots = sql(`SELECT count(DISTINCT slot) FROM oc_vo_presence p JOIN oc_vo_offices o ON o.id = p.office_id WHERE o.token = '${office.data.token}'`)
		expect(Number(slots)).toBe(32)
		await Promise.all(apis.map((api) => api.dispose()))
	})

	test('one character per person: second window must take over explicitly', async () => {
		const office = await teamOffice()
		const first = await enter(alice, office.token)
		expect(first.status).toBe(200)
		expect(first.data.you.generation).toBe(1)
		const second = await enter(alice, office.token)
		expect(second.status).toBe(409)
		expect(second.data).toMatchObject({ code: 'ACTIVE_ELSEWHERE', data: { sameOffice: true } })
		const taken = await enter(alice, office.token, second.session, true)
		expect(taken.status).toBe(200)
		expect(taken.data.you.generation).toBe(2)
		expect(taken.data.participants.filter((p: any) => p.uid === 'alice')).toHaveLength(1)
		expect((await alice.call('GET', `/offices/${office.token}/room?session=${first.session}&rev=0`)).data.code).toBe('TAKEN_OVER')
		expect((await alice.call('POST', `/offices/${office.token}/room/move`, { session: first.session, path: [[5, 17], [5, 16]] })).data.code).toBe('TAKEN_OVER')
		// The old window's leave must not remove the new one.
		await alice.call('POST', `/offices/${office.token}/room/leave`, { session: first.session })
		expect((await alice.call('GET', `/offices/${office.token}/room?session=${second.session}&rev=0`)).status).toBe(200)
	})

	test('moving to another office keeps the old one when the new one is full', async () => {
		const small = await teamOffice()
		const other = await teamOffice()
		await admin.call('PUT', '/admin/settings', { roomCapacity: 2 })
		try {
			await enter(bao, small.token)
			await enter((await Api.as('alice')), small.token)
			const inOther = await enter(alice, other.token)
			expect(inOther.data.code).toBe('ACTIVE_ELSEWHERE')
			sql("DELETE FROM oc_vo_presence WHERE uid = 'alice'")
			const aliceInOther = await enter(alice, other.token)
			expect(aliceInOther.status).toBe(200)
			const baoMoves = await enter(bao, other.token, session(), true)
			expect(baoMoves.status).toBe(200)
			// Bao is no longer in the small office.
			expect(Number(sql(`SELECT count(*) FROM oc_vo_presence p JOIN oc_vo_offices o ON o.id = p.office_id WHERE o.token = '${small.token}'`))).toBe(0)
			const third = await Api.as('bao')
			sql("DELETE FROM oc_vo_presence WHERE uid = 'bao'")
			await enter(third, other.token)
			const chiApi = await Api.as('alice')
			const full = await enter(chiApi, small.token, session(), true)
			expect(full.status).toBe(200)
		} finally {
			await admin.call('PUT', '/admin/settings', { roomCapacity: 32 })
		}
	})

	test('movement is validated and timed by the server', async () => {
		const office = await teamOffice()
		const me = await enter(alice, office.token)
		const start = me.data.participants.find((p: any) => p.uid === 'alice').trajectory.points[0]
		const path = [start, [start[0], start[1] - 1], [start[0], start[1] - 2]]
		const moved = await alice.call('POST', `/offices/${office.token}/room/move`, { session: me.session, path })
		expect(moved.status).toBe(200)
		const arrive = moved.data.participant.trajectory.arriveAt
		expect(arrive[1] - arrive[0]).toBe(250)
		expect(arrive[2] - arrive[1]).toBe(250)
		for (const bad of [[[1, 1], [3, 1]], [[16, 10]], [['5', '5']], [[5.5, 5]], 'x', Array.from({ length: 70 }, (_, i) => [5, 13 + (i % 2)])]) {
			expect((await alice.call('POST', `/offices/${office.token}/room/move`, { session: me.session, path: bad })).status).toBe(422)
		}
		const conflict = await alice.call('POST', `/offices/${office.token}/room/move`, { session: me.session, path: [[20, 5]] })
		expect(conflict.status).toBe(409)
		expect(conflict.data.data.participant.uid).toBe('alice')
		expect((await alice.call('POST', `/offices/${office.token}/room/move`, { session: 'nothex', path })).status).toBe(422)
	})

	test('reactions, modes and props', async () => {
		const office = await teamOffice()
		const me = await enter(alice, office.token)
		expect((await alice.call('POST', `/offices/${office.token}/room/emote`, { session: me.session, emote: 'wave' })).data.participant.emote.id).toBe('wave')
		expect((await alice.call('POST', `/offices/${office.token}/room/emote`, { session: me.session, emote: 'heart' })).status).toBe(429)
		expect((await alice.call('POST', `/offices/${office.token}/room/emote`, { session: me.session, emote: 'dance' })).status).toBe(422)
		expect((await alice.call('POST', `/offices/${office.token}/room/mode`, { session: me.session, mode: 'focus' })).data.participant.mode).toBe('focus')
		expect((await alice.call('POST', `/offices/${office.token}/room/mode`, { session: me.session, mode: 'busy' })).status).toBe(422)
		expect((await alice.call('POST', `/offices/${office.token}/room/interact`, { session: me.session, prop: 'coffee' })).data.code).toBe('OUT_OF_REACH')
		const start = me.data.participants.find((p: any) => p.uid === 'alice').trajectory.points[0]
		// Walk from the entrance to the coffee machine: up the entrance, through the door, to (3,2).
		const path: number[][] = [start]
		let [x, y] = start
		while (y > 10) {
			path.push([x, --y])
		}
		while (x !== 4) {
			path.push([x > 4 ? --x : ++x, y])
		}
		while (y > 2) {
			path.push([x, --y])
		}
		path.push([3, 2])
		expect((await alice.call('POST', `/offices/${office.token}/room/move`, { session: me.session, path })).status).toBe(200)
		await new Promise((r) => setTimeout(r, path.length * 250 + 100))
		const used = await alice.call('POST', `/offices/${office.token}/room/interact`, { session: me.session, prop: 'coffee' })
		expect(used.data.outcome).toBe('started')
		expect((await alice.call('POST', `/offices/${office.token}/room/interact`, { session: me.session, prop: 'coffee' })).data.outcome).toBe('already-active')
		expect((await alice.call('POST', `/offices/${office.token}/room/interact`, { session: me.session, prop: 'piano' })).status).toBe(422)
	})

	test('polling returns data only when the room changed', async () => {
		const office = await teamOffice()
		const a = await enter(alice, office.token)
		const b = await enter(bao, office.token)
		const first = await alice.call('GET', `/offices/${office.token}/room?session=${a.session}&rev=${a.data.rev}`)
		expect(first.data.changed).toBe(true)
		expect(first.data.participants).toHaveLength(2)
		const second = await alice.call('GET', `/offices/${office.token}/room?session=${a.session}&rev=${first.data.rev}`)
		expect(second.data).toEqual({ changed: false, rev: first.data.rev, serverTime: expect.any(Number) })
		await bao.call('POST', `/offices/${office.token}/room/leave`, { session: b.session })
		const third = await alice.call('GET', `/offices/${office.token}/room?session=${a.session}&rev=${first.data.rev}`)
		expect(third.data.participants.map((p: any) => p.uid)).toEqual(['alice'])
	})

	test('an expired lease removes the person for everyone', async () => {
		const office = await teamOffice()
		const a = await enter(alice, office.token)
		const b = await enter(bao, office.token)
		sql("UPDATE oc_vo_presence SET lease_until = 1 WHERE uid = 'bao'")
		const poll = await alice.call('GET', `/offices/${office.token}/room?session=${a.session}&rev=${a.data.rev}`)
		expect(poll.data.participants.map((p: any) => p.uid)).toEqual(['alice'])
		expect((await bao.call('GET', `/offices/${office.token}/room?session=${b.session}&rev=0`)).data.code).toBe('NOT_PRESENT')
	})

	test('the background job removes leases nobody polled', async () => {
		const office = await teamOffice()
		await enter(bao, office.token)
		sql("UPDATE oc_vo_presence SET lease_until = 1 WHERE uid = 'bao'")
		const jobId = sql("SELECT id FROM oc_jobs WHERE class = 'OCA\\VirtualOffice\\BackgroundJob\\ExpirePresence'")
		occ('background-job:execute', '--force-execute', jobId)
		expect(sql("SELECT count(*) FROM oc_vo_presence WHERE uid = 'bao'")).toBe('0')
	})
})

test.describe('losing access', () => {
	test('leaving the group ends presence right away', async () => {
		occ('group:adduser', 'virtualoffice-fixture', 'chi')
		const office = await admin.call('POST', '/offices', { title: uniqueName('Group'), audience: { kind: 'group', id: 'virtualoffice-fixture' }, managerUid: 'alice' })
		const c = await enter(chi, office.data.token)
		expect(c.status).toBe(200)
		occ('group:removeuser', 'virtualoffice-fixture', 'chi')
		expect(sql("SELECT count(*) FROM oc_vo_presence WHERE uid = 'chi'")).toBe('0')
		expect((await chi.call('GET', `/offices/${office.data.token}/room?session=${c.session}&rev=0`)).status).toBe(410)
		expect((await enter(chi, office.data.token)).status).toBe(404)
	})

	test('leaving the Team ends presence within the re-check window', async () => {
		const team = createTeam('alice', uniqueName('Short team'), ['chi'])
		const office = await alice.call('POST', '/offices', { title: uniqueName('Team'), audience: { kind: 'team', id: team } })
		const c = await enter(chi, office.data.token)
		expect(c.status).toBe(200)
		await removeFromTeam(alice, team, 'chi')
		const started = Date.now()
		const denied = await waitFor(async () => {
			const r = await chi.call('GET', `/offices/${office.data.token}/room?session=${c.session}&rev=0`)
			return r.status !== 200 ? r : undefined
		}, 30_000, 1000)
		expect(denied.status).toBe(404)
		expect(Date.now() - started).toBeLessThanOrEqual(21_500)
		expect(sql("SELECT count(*) FROM oc_vo_presence WHERE uid = 'chi'")).toBe('0')
	})

	test('a disabled account is taken out', async () => {
		occ('user:enable', 'disabled')
		occ('group:adduser', 'virtualoffice-fixture', 'disabled')
		const office = await admin.call('POST', '/offices', { title: uniqueName('Group'), audience: { kind: 'group', id: 'virtualoffice-fixture' }, managerUid: 'alice' })
		const d = await Api.as('disabled')
		expect((await enter(d, office.data.token)).status).toBe(200)
		occ('user:disable', 'disabled')
		occ('group:removeuser', 'virtualoffice-fixture', 'disabled')
		expect(sql("SELECT count(*) FROM oc_vo_presence WHERE uid = 'disabled'")).toBe('0')
	})

	test('managers remove people for a while and let them back in', async () => {
		const office = await teamOffice()
		const b = await enter(bao, office.token)
		expect((await bao.call('PUT', `/offices/${office.token}/removals`, { uid: 'alice', minutes: 60 })).status).toBe(403)
		expect((await alice.call('PUT', `/offices/${office.token}/removals`, { uid: 'bao', minutes: 7 })).status).toBe(422)
		const removed = await alice.call('PUT', `/offices/${office.token}/removals`, { uid: 'bao', minutes: 15 })
		expect(removed.data.removals.map((r: any) => r.uid)).toEqual(['bao'])
		expect(sql("SELECT count(*) FROM oc_vo_presence WHERE uid = 'bao'")).toBe('0')
		expect((await bao.call('GET', `/offices/${office.token}/room?session=${b.session}&rev=0`)).status).toBe(410)
		const again = await enter(bao, office.token)
		expect(again.data.code).toBe('OFFICE_REMOVED')
		expect((await bao.call('GET', `/offices/${office.token}`)).data.permissions.canEnter).toBe(false)
		await alice.call('DELETE', `/offices/${office.token}/removals`, { uid: 'bao' })
		expect((await enter(bao, office.token)).status).toBe(200)
	})

	test('deleting an office ends every presence', async () => {
		const office = await teamOffice()
		await enter(bao, office.token)
		expect((await alice.call('DELETE', `/offices/${office.token}`, undefined, { 'If-Match': '"1"' })).status).toBe(200)
		expect(sql("SELECT count(*) FROM oc_vo_presence WHERE uid = 'bao'")).toBe('0')
		expect((await bao.call('GET', `/offices/${office.token}`)).status).toBe(404)
	})

	test('deleting an account removes its presence and roles', async () => {
		occ('user:add', '--password-from-env', 'temp_manager')
		occ('group:adduser', 'virtualoffice-fixture', 'temp_manager')
		const office = await admin.call('POST', '/offices', { title: uniqueName('Group'), audience: { kind: 'group', id: 'virtualoffice-fixture' }, managerUid: 'temp_manager' })
		const temp = await Api.as('temp_manager')
		expect((await enter(temp, office.data.token)).status).toBe(200)
		occ('user:delete', 'temp_manager')
		expect(sql("SELECT count(*) FROM oc_vo_presence WHERE uid = 'temp_manager'")).toBe('0')
		const after = await admin.call('GET', `/offices/${office.data.token}`)
		expect(after.data.managers).toEqual([])
		expect((await admin.call('GET', '/admin/offices')).data.find((o: any) => o.token === office.data.token).unmanaged).toBe(true)
	})
})

test.describe('integrations', () => {
	test('Talk: bind a Team conversation and open it only while it is shared', async () => {
		const office = await teamOffice()
		const room = await alice.call('POST', '/ocs/v2.php/apps/spreed/api/v4/room', { roomType: 2, roomName: uniqueName('Standup') })
		expect(room.status).toBe(201)
		const talkToken = room.data.token
		expect((await alice.call('POST', `/ocs/v2.php/apps/spreed/api/v4/room/${talkToken}/participants`, { newParticipant: teamId, source: 'circles' })).status).toBe(200)
		const candidates = await alice.call('GET', `/offices/${office.token}/talk-conversations`)
		expect(candidates.data.map((c: any) => c.token)).toContain(talkToken)
		expect((await bao.call('GET', `/offices/${office.token}/talk-conversations`)).status).toBe(403)
		const bound = await alice.call('PATCH', `/offices/${office.token}`, { talk: { source: 'team', token: talkToken } }, { 'If-Match': '"1"' })
		expect(bound.data.config.talk).toMatchObject({ source: 'team', token: talkToken })
		// Members who can open the conversation get its token, to post the office there.
		expect((await bao.call('GET', `/offices/${office.token}`)).data.config.talk).toEqual({ source: 'team', label: expect.any(String), token: talkToken })
		expect((await bao.call('GET', `/offices/${office.token}`)).data.talkAvailable).toBe(true)

		const redirect = await bao.raw('GET', `/index.php/apps/virtualoffice/o/${office.token}/talk`)
		expect(redirect.status()).toBe(303)
		expect(redirect.headers().location).toContain(`/call/${talkToken}`)
		expect((await chi.raw('GET', `/index.php/apps/virtualoffice/o/${office.token}/talk`)).status()).toBe(404)
		// Opening the link never makes anyone join the conversation or a call.
		const participants = await alice.call('GET', `/ocs/v2.php/apps/spreed/api/v4/room/${talkToken}/participants`)
		expect(participants.data.every((p: any) => p.inCall === 0)).toBe(true)

		const circle = participants.data.find((p: any) => p.actorType === 'circles')
		await alice.call('DELETE', `/ocs/v2.php/apps/spreed/api/v4/room/${talkToken}/attendees`, { attendeeId: circle.attendeeId })
		expect((await bao.raw('GET', `/index.php/apps/virtualoffice/o/${office.token}/talk`)).status()).toBe(404)
		expect((await bao.call('GET', `/offices/${office.token}`)).data.config.talk).toEqual({ source: 'team', label: expect.any(String) })
		expect((await alice.call('PATCH', `/offices/${office.token}`, { talk: { source: 'team', token: talkToken } }, { 'If-Match': '"2"' })).status).toBe(422)
	})

	test('Talk: a pasted link must point to this Nextcloud', async () => {
		const office = await teamOffice()
		expect((await alice.call('PATCH', `/offices/${office.token}`, { talk: { source: 'link', url: 'https://evil.example/call/abcd1234', label: 'X' } }, { 'If-Match': '"1"' })).status).toBe(422)
		const ok = await alice.call('PATCH', `/offices/${office.token}`, { talk: { source: 'link', url: 'http://localhost:18935/index.php/call/abcd1234', label: 'Lounge' } }, { 'If-Match': '"1"' })
		expect(ok.data.config.talk).toMatchObject({ source: 'link', token: 'abcd1234', label: 'Lounge' })
	})

	test('reference previews stay generic in the shared cache', async () => {
		const office = await teamOffice(uniqueName('Secret project room'))
		const url = `http://localhost:18935/index.php/apps/virtualoffice/o/${office.token}`
		for (const viewer of [alice, chi]) {
			const resolved = await viewer.call('GET', `/ocs/v2.php/references/resolve?reference=${encodeURIComponent(url)}`)
			const reference = resolved.data.references[url]
			expect(reference.richObjectType).toBe('virtualoffice_office')
			expect(reference.richObject.token).toBe(office.token)
			expect(reference.openGraphObject.thumb).toMatch(/\/office-preview\.webp$/)
			expect(JSON.stringify(reference)).not.toContain('Secret project room')
			expect(JSON.stringify(reference)).not.toContain('count')
		}
		const card = await alice.call('GET', `/offices/${office.token}/card`)
		expect(card.data).toMatchObject({ title: office.title, count: 0 })
	})

	test('Unified Search only returns offices the searcher belongs to', async () => {
		const office = await teamOffice(uniqueName('Searchable studio'))
		const term = encodeURIComponent('Searchable studio')
		const found = await alice.call('GET', `/ocs/v2.php/search/providers/virtualoffice/search?term=${term}`)
		expect(found.data.entries.map((e: any) => e.resourceUrl)).toContain(office.url)
		const hidden = await chi.call('GET', `/ocs/v2.php/search/providers/virtualoffice/search?term=${term}`)
		expect(hidden.data.entries).toEqual([])
	})

	test('the Team page lists its offices for members', async () => {
		const office = await teamOffice()
		const resources = await alice.call('GET', `/ocs/v2.php/teams/${teamId}/resources`)
		expect(resources.data.resources.filter((r: any) => r.provider.id === 'virtualoffice').map((r: any) => r.id)).toContain(office.token)
		const outsider = await chi.call('GET', `/ocs/v2.php/teams/${teamId}/resources`)
		expect(JSON.stringify(outsider.data)).not.toContain(office.token)
	})
})

test.describe('Talk conversation offices', () => {
	const TALK = '/ocs/v2.php/apps/spreed/api/v4'

	async function conversation(name: string, members: string[]) {
		const room = await alice.call('POST', `${TALK}/room`, { roomType: 2, roomName: name })
		for (const uid of members) {
			await alice.call('POST', `${TALK}/room/${room.data.token}/participants`, { newParticipant: uid, source: 'users' })
		}
		return room.data.token as string
	}

	test('every participant reaches the same office; others do not', async () => {
		const talk = await conversation(uniqueName('Retro'), ['bao'])
		const first = await bao.call('POST', `/conversations/${talk}/office`)
		expect(first.status).toBe(200)
		expect(first.data.created).toBe(true)
		expect(first.data.office.audience).toMatchObject({ kind: 'talk', id: talk })
		expect(first.data.office.links.call).toContain(`/call/${talk}#direct-call`)
		const second = await alice.call('POST', `/conversations/${talk}/office`)
		expect(second.data).toMatchObject({ created: false, office: { token: first.data.office.token } })
		const token = first.data.office.token
		expect((await chi.call('POST', `/conversations/${talk}/office`)).status).toBe(404)
		expect((await chi.call('GET', `/offices/${token}`)).status).toBe(404)
		expect((await enter(chi, token)).status).toBe(404)
		expect((await alice.call('GET', '/offices')).data.map((o: any) => o.token)).toContain(token)
		expect((await chi.call('GET', '/offices')).data.map((o: any) => o.token)).not.toContain(token)
		expect((await bao.call('PATCH', `/offices/${token}`, { title: 'Mine now' }, { 'If-Match': '"1"' })).status).toBe(422)
	})

	test('one-to-one conversations do not get an office', async () => {
		const direct = await alice.call('POST', `${TALK}/room`, { roomType: 1, invite: 'bao' })
		expect((await alice.call('POST', `/conversations/${direct.data.token}/office`)).data.code).toBe('CONVERSATION_NOT_SUPPORTED')
	})

	test('the office follows the conversation: rename, removal and deletion', async () => {
		const talk = await conversation(uniqueName('Planning'), ['bao'])
		const office = (await alice.call('POST', `/conversations/${talk}/office`)).data.office
		await alice.call('PUT', `${TALK}/room/${talk}`, { roomName: 'Planning, renamed' })
		expect((await bao.call('GET', `/offices/${office.token}`)).data.title).toBe('Planning, renamed')

		const b = await enter(bao, office.token)
		expect(b.status).toBe(200)
		const participants = (await alice.call('GET', `${TALK}/room/${talk}/participants`)).data
		const attendee = participants.find((p: any) => p.actorId === 'bao')
		await alice.call('DELETE', `${TALK}/room/${talk}/attendees`, { attendeeId: attendee.attendeeId })
		expect(sql("SELECT count(*) FROM oc_vo_presence WHERE uid = 'bao'")).toBe('0')
		expect((await bao.call('GET', `/offices/${office.token}`)).status).toBe(404)

		await alice.call('DELETE', `${TALK}/room/${talk}`)
		expect(sql(`SELECT count(*) FROM oc_vo_offices WHERE token = '${office.token}'`)).toBe('0')
	})
})

test.describe('review regressions', () => {
	const TALK = '/ocs/v2.php/apps/spreed/api/v4'

	test('a call is no longer shown once the conversation is unshared from the Team', async () => {
		const office = await teamOffice()
		const room = await alice.call('POST', `${TALK}/room`, { roomType: 2, roomName: uniqueName('Standup') })
		await alice.call('POST', `${TALK}/room/${room.data.token}/participants`, { newParticipant: teamId, source: 'circles' })
		await alice.call('PATCH', `/offices/${office.token}`, { talk: { source: 'team', token: room.data.token } }, { 'If-Match': '"1"' })
		sql(`UPDATE oc_vo_offices SET room_state = '{"call":{"known":true,"active":true,"since":1,"participants":["chi"]}}' WHERE token = '${office.token}'`)
		expect((await bao.call('GET', `/offices/${office.token}`)).data.call).toMatchObject({ active: true, names: { chi: 'Chi' } })
		const circle = (await alice.call('GET', `${TALK}/room/${room.data.token}/participants`)).data.find((p: any) => p.actorType === 'circles')
		await alice.call('DELETE', `${TALK}/room/${room.data.token}/attendees`, { attendeeId: circle.attendeeId })
		expect((await bao.call('GET', `/offices/${office.token}`)).data.call).toBeNull()
		expect((await bao.call('GET', `/offices/${office.token}/card`)).data.call).toBeNull()
	})

	test('a new conversation office does not claim there is no call', async () => {
		const room = await alice.call('POST', `${TALK}/room`, { roomType: 2, roomName: uniqueName('Sync') })
		const office = (await alice.call('POST', `/conversations/${room.data.token}/office`)).data.office
		expect(office.call).toMatchObject({ known: false, active: false })
	})

	test('admins keep managing offices while Talk is disabled', async () => {
		const room = await alice.call('POST', `${TALK}/room`, { roomType: 2, roomName: uniqueName('Ops') })
		const office = (await alice.call('POST', `/conversations/${room.data.token}/office`)).data.office
		occ('app:disable', 'spreed')
		try {
			expect((await admin.call('GET', '/admin/offices')).status).toBe(200)
			const read = await admin.call('GET', `/offices/${office.token}`)
			expect(read.status).toBe(200)
			expect(read.data.permissions).toMatchObject({ canManage: true, canEnter: false })
			expect((await alice.call('GET', `/offices/${office.token}`)).status).toBe(503)
			expect((await enter(alice, office.token)).status).toBe(503)
		} finally {
			occ('app:enable', 'spreed')
		}
	})

	test('someone removed from the Team disappears for others without polling themselves', async () => {
		const team = createTeam('alice', uniqueName('Quiet team'), ['chi', 'bao'])
		const office = (await alice.call('POST', '/offices', { title: uniqueName('Quiet'), audience: { kind: 'team', id: team } })).data
		await enter(chi, office.token)
		const b = await enter(bao, office.token)
		await removeFromTeam(alice, team, 'chi')
		const started = Date.now()
		await waitFor(async () => {
			await bao.call('GET', `/offices/${office.token}/room?session=${b.session}&rev=0`)
			return sql("SELECT count(*) FROM oc_vo_presence WHERE uid = 'chi'") === '0'
		}, 35_000, 1000)
		expect(Date.now() - started).toBeLessThanOrEqual(23_000)
		expect((await bao.call('GET', `/offices/${office.token}/card`)).data.people.map((p: any) => p.uid)).toEqual(['bao'])
	})

	test('pages list every office once, across Teams and conversations', async () => {
		const tokens = new Set<string>()
		for (let i = 0; i < 52; i++) {
			tokens.add((await alice.call('POST', '/offices', { title: `Paging ${String(i).padStart(2, '0')}`, audience: { kind: 'team', id: teamId } })).data.token)
		}
		for (let i = 0; i < 3; i++) {
			const room = await alice.call('POST', `${TALK}/room`, { roomType: 2, roomName: `Paging chat ${i}` })
			tokens.add((await alice.call('POST', `/conversations/${room.data.token}/office`)).data.office.token)
		}
		const listed: string[] = []
		for (let offset = 0; ; offset += 50) {
			const page = (await alice.call('GET', `/offices?search=Paging&limit=50&offset=${offset}`)).data.map((o: any) => o.token)
			listed.push(...page)
			if (page.length < 50) {
				break
			}
		}
		expect(new Set(listed).size).toBe(listed.length)
		expect(listed.filter((t) => tokens.has(t))).toHaveLength(tokens.size)
	})

	test('only one of several simultaneous preference saves wins', async () => {
		await bao.call('DELETE', '/me/preferences')
		const prefs = (creature: string) => ({ appearance: { creature, palette: 'sky', accessory: 'none' }, ui: { view: 'scene', reducedEffects: false, announcements: true } })
		const results = await Promise.all(['cat', 'bear', 'bird', 'rabbit', 'cat'].map((c) => bao.call('PUT', '/me/preferences', { revision: 0, preferences: prefs(c) })))
		expect(results.filter((r) => r.status === 200)).toHaveLength(1)
		expect(results.every((r) => [200, 409, 412].includes(r.status))).toBe(true)
		await bao.call('DELETE', '/me/preferences')
	})
})

test.describe('desks, notes and status', () => {
	const STATUS = '/ocs/v2.php/apps/user_status/api/v1/user_status/status'

	test('members claim, move and free desks; managers free any', async () => {
		const office = await teamOffice()
		const inside = await enter(alice, office.token)
		const before = inside.data.desksRev
		const claimed = await bao.call('PUT', `/offices/${office.token}/desks/d3`)
		expect(claimed.status).toBe(200)
		expect(claimed.data.desks).toEqual([{ deskId: 'd3', uid: 'bao', name: 'Bảo', note: null, birthday: false }])
		expect((await alice.call('PUT', `/offices/${office.token}/desks/d3`)).data.code).toBe('DESK_TAKEN')
		expect((await bao.call('PUT', `/offices/${office.token}/desks/d99`)).status).toBe(422)
		expect((await chi.call('GET', `/offices/${office.token}/desks`)).status).toBe(404)
		expect((await chi.call('PUT', `/offices/${office.token}/desks/d4`)).status).toBe(404)

		// Claiming another desk moves the claim; the room learns about it through its revision.
		expect((await bao.call('PUT', `/offices/${office.token}/desks/d5`)).data.desks.map((d: any) => d.deskId)).toEqual(['d5'])
		const a = await alice.call('GET', `/offices/${office.token}/room?session=${inside.session}&rev=0`)
		expect(a.data.desksRev).toBe(before + 2)

		expect((await bao.call('DELETE', `/offices/${office.token}/desks/d5`)).data.desks).toEqual([])
		await bao.call('PUT', `/offices/${office.token}/desks/d1`)
		expect((await alice.call('DELETE', `/offices/${office.token}/desks/d1`)).data.desks).toEqual([])
		await alice.call('PUT', `/offices/${office.token}/desks/d2`)
		expect((await bao.call('DELETE', `/offices/${office.token}/desks/d2`)).data.code).toBe('ACTION_DENIED')
	})

	test('someone who left the Team loses their desk', async () => {
		const team = createTeam('alice', uniqueName('Desk team'), ['bao', 'chi'])
		const office = (await alice.call('POST', '/offices', { title: uniqueName('Desks'), audience: { kind: 'team', id: team } })).data
		await chi.call('PUT', `/offices/${office.token}/desks/d7`)
		await removeFromTeam(alice, team, 'chi')
		// The owner check is trusted for a minute; expire it instead of waiting.
		sql("UPDATE oc_vo_desks SET authorized_until = 0 WHERE uid = 'chi'")
		expect((await bao.call('GET', `/offices/${office.token}/desks`)).data.desks).toEqual([])
		expect(sql("SELECT count(*) FROM oc_vo_desks WHERE uid = 'chi'")).toBe('0')
	})

	test('the Today note shows with the person and their desk until it expires', async () => {
		const office = await teamOffice()
		const a = await enter(alice, office.token)
		await bao.call('PUT', `/offices/${office.token}/desks/d4`)
		expect((await bao.call('PUT', '/me/today', { text: 'x'.repeat(81), expiresAt: Date.now() + 60_000 })).status).toBe(422)
		const set = await bao.call('PUT', '/me/today', { text: '  Viết   báo cáo Q3 ', expiresAt: Date.now() + 3_600_000 })
		expect(set.data.today.text).toBe('Viết báo cáo Q3')
		expect((await bao.call('GET', '/me/today')).data.today.text).toBe('Viết báo cáo Q3')
		expect((await alice.call('GET', `/offices/${office.token}/desks`)).data.desks[0].note).toBe('Viết báo cáo Q3')
		const b = await enter(bao, office.token)
		expect(b.data.participants.find((p: any) => p.uid === 'bao').note).toBe('Viết báo cáo Q3')
		// Changing it inside the office reaches the others.
		await bao.call('PUT', '/me/today', { text: 'Done with Q3', expiresAt: Date.now() + 3_600_000 })
		const polled = await alice.call('GET', `/offices/${office.token}/room?session=${a.session}&rev=0`)
		expect(polled.data.participants.find((p: any) => p.uid === 'bao').note).toBe('Done with Q3')
		expect((await bao.call('PUT', '/me/today', { text: '', expiresAt: Date.now() })).data.today).toBeNull()
		expect((await alice.call('GET', `/offices/${office.token}/desks`)).data.desks[0].note).toBeNull()
	})

	test('desk owners and people inside show their Nextcloud status, never invisible', async () => {
		const office = await teamOffice()
		await bao.call('PUT', `/offices/${office.token}/desks/d6`)
		try {
			await bao.call('PUT', STATUS, { statusType: 'dnd' })
			expect((await alice.call('GET', `/offices/${office.token}/desks`)).data.statuses.bao.status).toBe('dnd')
			await bao.call('PUT', STATUS, { statusType: 'invisible' })
			expect((await alice.call('GET', `/offices/${office.token}/desks`)).data.statuses.bao).toBeUndefined()
		} finally {
			await bao.call('PUT', STATUS, { statusType: 'online' })
		}
	})
})

test.describe('knocks', () => {
	const NOTIFICATIONS = '/ocs/v2.php/apps/notifications/api/v2/notifications'

	test('a knock reaches only the person asked, and the answer comes back', async () => {
		const office = await teamOffice()
		for (const api of [alice, bao]) {
			await api.call('DELETE', NOTIFICATIONS)
		}
		const knocked = await alice.call('POST', `/offices/${office.token}/knocks`, { uid: 'bao' })
		expect(knocked.status).toBe(201)
		expect((await alice.call('POST', `/offices/${office.token}/knocks`, { uid: 'bao' })).data.code).toBe('KNOCK_PENDING')
		expect((await alice.call('POST', `/offices/${office.token}/knocks`, { uid: 'chi' })).data.code).toBe('PERSON_UNAVAILABLE')
		expect((await alice.call('POST', `/offices/${office.token}/knocks`, { uid: 'alice' })).data.code).toBe('PERSON_UNAVAILABLE')
		expect((await chi.call('POST', `/offices/${office.token}/knocks`, { uid: 'bao' })).status).toBe(404)

		const [notification] = ((await bao.call('GET', NOTIFICATIONS)).data as any[]).filter((n) => n.app === 'virtualoffice')
		expect(notification.subject).toBe('Alice knocked: got 2 minutes?')
		expect(notification.message).toBe(`In ${office.title}`)
		expect(notification.actions.map((a: any) => a.label)).toEqual(['Now', 'In 10 minutes', 'Later'])
		expect((await chi.call('POST', `/knocks/${knocked.data.id}`, { answer: 'now' })).data.code).toBe('KNOCK_GONE')

		// Notifications only follows web links, so "Now" opens the office page, which answers.
		const now = notification.actions.find((a: any) => a.label === 'Now')
		expect(now.type).toBe('WEB')
		expect(now.link).toBe(`${office.url}?knock=${knocked.data.id}&answer=now`)
		const later = notification.actions.find((a: any) => a.label === 'Later')
		expect(later.type).toBe('POST')
		const answered = await bao.call('POST', `/knocks/${knocked.data.id}`, { answer: 'now' })
		expect(answered.status).toBe(200)
		expect(answered.data.link).toContain('/apps/spreed/?callUser=alice#direct-call')
		expect(((await bao.call('GET', NOTIFICATIONS)).data as any[]).filter((n) => n.app === 'virtualoffice')).toEqual([])
		const [reply] = ((await alice.call('GET', NOTIFICATIONS)).data as any[]).filter((n) => n.app === 'virtualoffice')
		expect(reply.subject).toBe('Bảo can talk now')
		expect(reply.link).toContain('/apps/spreed/?callUser=bao#direct-call')
		expect(sql(`SELECT count(*) FROM oc_vo_knocks WHERE id = ${knocked.data.id}`)).toBe('0')
		expect((await bao.call('POST', `/knocks/${knocked.data.id}`, { answer: 'later' })).data.code).toBe('KNOCK_GONE')
	})

	test('unanswered knocks expire with their notification', async () => {
		const office = await teamOffice()
		await bao.call('DELETE', NOTIFICATIONS)
		await alice.call('POST', `/offices/${office.token}/knocks`, { uid: 'bao' })
		sql('UPDATE oc_vo_knocks SET created_at = 1')
		occ('background-job:execute', '--force-execute', JSON.parse(occ('background-job:list', '--output=json', '--class=OCA\\VirtualOffice\\BackgroundJob\\ExpirePresence'))[0].id)
		expect(sql('SELECT count(*) FROM oc_vo_knocks')).toBe('0')
		expect(((await bao.call('GET', NOTIFICATIONS)).data as any[]).filter((n) => n.app === 'virtualoffice')).toEqual([])
	})
})

test.describe('dashboard and arrivals', () => {
	const NOTIFICATIONS = '/ocs/v2.php/apps/notifications/api/v2/notifications'
	const ours = async (api: Api) => ((await api.call('GET', NOTIFICATIONS)).data as any[]).filter((n) => n.app === 'virtualoffice')

	test('the Dashboard widget lists who is in your offices', async () => {
		const office = await teamOffice()
		await enter(alice, office.token)
		const widget = await bao.call('GET', '/ocs/v2.php/apps/dashboard/api/v2/widget-items?widgets[]=virtualoffice')
		expect(widget.status).toBe(200)
		const item = widget.data.virtualoffice.items.find((i: any) => i.title === office.title)
		expect(item).toMatchObject({ subtitle: 'Alice', link: office.url })
		expect((await chi.call('GET', '/ocs/v2.php/apps/dashboard/api/v2/widget-items?widgets[]=virtualoffice')).data.virtualoffice.items.map((i: any) => i.title)).not.toContain(office.title)
	})

	test('"tell me when someone arrives" fires once, only while they are there', async () => {
		const office = await teamOffice()
		await bao.call('DELETE', NOTIFICATIONS)
		expect((await chi.call('PUT', `/offices/${office.token}/watch`, { expiresAt: Date.now() + 60_000 })).status).toBe(404)
		const set = await bao.call('PUT', `/offices/${office.token}/watch`, { expiresAt: Date.now() + 999_999_999 })
		expect(set.data.watching).toBe(true)
		expect(set.data.expiresAt).toBeLessThanOrEqual(Date.now() + 86_400_000)
		expect((await bao.call('GET', `/offices/${office.token}/watch`)).data.watching).toBe(true)

		const a = await enter(alice, office.token)
		const [arrival] = await ours(bao)
		expect(arrival.subject).toBe('Alice is in the office')
		expect(arrival.link).toBe(office.url)
		expect((await bao.call('GET', `/offices/${office.token}/watch`)).data.watching).toBe(false)

		// One-shot: coming back in does not notify again, and leaving hides the notification.
		await alice.call('POST', `/offices/${office.token}/room/leave`, { session: a.session })
		expect(await ours(bao)).toEqual([])
		await enter(alice, office.token)
		expect(await ours(bao)).toEqual([])
	})

	test('your own entry ends your request instead of notifying you', async () => {
		const office = await teamOffice()
		await bao.call('DELETE', NOTIFICATIONS)
		await bao.call('PUT', `/offices/${office.token}/watch`, { expiresAt: Date.now() + 60_000 })
		await enter(bao, office.token)
		expect((await bao.call('GET', `/offices/${office.token}/watch`)).data.watching).toBe(false)
		expect(await ours(bao)).toEqual([])
	})
})

test.describe('Team places', () => {
	const TALK = '/ocs/v2.php/apps/spreed/api/v4'

	test('resources shared with the Team show in its office, for members only', async () => {
		const team = createTeam('alice', uniqueName('Places team'), ['bao'])
		const office = (await alice.call('POST', '/offices', { title: uniqueName('Places'), audience: { kind: 'team', id: team } })).data
		const boardTitle = uniqueName('Roadmap')
		const board = await alice.call('POST', '/index.php/apps/deck/api/v1.0/boards', { title: boardTitle, color: '0082c9' })
		expect(board.status).toBe(200)
		expect((await alice.call('POST', `/index.php/apps/deck/api/v1.0/boards/${board.data.id}/acl`, { type: 7, participant: team, permissionEdit: true, permissionShare: false, permissionManage: false })).status).toBe(200)

		const listed = await bao.call('GET', `/offices/${office.token}/resources`)
		expect(listed.status).toBe(200)
		const deck = listed.data.find((r: any) => r.provider === 'deck')
		expect(deck).toMatchObject({ id: String(board.data.id), label: boardTitle })
		expect(deck.url).toContain(`/apps/deck/board/${board.data.id}`)
		expect(listed.data.map((r: any) => r.provider)).not.toContain('virtualoffice')
		expect((await chi.call('GET', `/offices/${office.token}/resources`)).status).toBe(404)
	})

	test('a conversation office points to the office of its Team', async () => {
		const team = createTeam('alice', uniqueName('Linked team'), ['bao'])
		const teamOffice = (await alice.call('POST', '/offices', { title: uniqueName('Team room'), audience: { kind: 'team', id: team } })).data
		const room = await alice.call('POST', `${TALK}/room`, { roomType: 2, roomName: uniqueName('Team chat') })
		expect((await alice.call('POST', `${TALK}/room/${room.data.token}/participants`, { newParticipant: team, source: 'circles' })).status).toBe(200)
		expect((await bao.call('POST', `/conversations/${room.data.token}/office`)).status).toBe(200)
		expect((await bao.call('GET', `/conversations/${room.data.token}/team-offices`)).data).toEqual([{ token: teamOffice.token, title: teamOffice.title, url: teamOffice.url }])
		expect((await chi.call('GET', `/conversations/${room.data.token}/team-offices`)).data).toEqual([])
	})
})

test.describe('focus, roulette and birthdays', () => {
	const NOTIFICATIONS = '/ocs/v2.php/apps/notifications/api/v2/notifications'

	test('people focus together; the last one out ends the session', async () => {
		const office = await teamOffice()
		const a = await enter(alice, office.token)
		const b = await enter(bao, office.token)
		expect((await alice.call('POST', `/offices/${office.token}/room/focus`, { session: a.session, minutes: 30 })).status).toBe(422)
		const started = await alice.call('POST', `/offices/${office.token}/room/focus`, { session: a.session, minutes: 25 })
		expect(started.data.focus).toMatchObject({ minutes: 25, uids: ['alice'] })
		expect(started.data.focus.endsAt - started.data.focus.startedAt).toBe(25 * 60_000)
		expect((await bao.call('POST', `/offices/${office.token}/room/focus`, { session: b.session, minutes: 50 })).data.focus).toMatchObject({ minutes: 25, uids: ['alice', 'bao'] })
		// Leaving the office also leaves the session.
		await alice.call('POST', `/offices/${office.token}/room/leave`, { session: a.session })
		expect((await bao.call('GET', `/offices/${office.token}/room?session=${b.session}&rev=0`)).data.focus.uids).toEqual(['bao'])
		expect((await bao.call('POST', `/offices/${office.token}/room/focus/leave`, { session: b.session })).data.focus).toBeNull()
		expect((await bao.call('GET', `/offices/${office.token}/room?session=${b.session}&rev=0`)).data.focus).toBeNull()
	})

	test('the weekly coffee roulette pairs people who joined', async () => {
		const office = (await admin.call('POST', '/offices', { title: uniqueName('Everyone'), audience: { kind: 'group', id: 'virtualoffice-fixture' }, managerUid: 'alice' })).data
		expect((await alice.call('GET', `/offices/${office.token}/roulette`)).data).toEqual({ available: true, joined: false })
		expect((await alice.call('PUT', `/offices/${(await teamOffice()).token}/roulette`)).status).toBe(422)
		for (const api of [alice, bao]) {
			expect((await api.call('PUT', `/offices/${office.token}/roulette`)).data.joined).toBe(true)
			await api.call('DELETE', NOTIFICATIONS)
		}
		sql(`DELETE FROM oc_vo_roulette WHERE office_id <> (SELECT id FROM oc_vo_offices WHERE token = '${office.token}')`)
		occ('background-job:execute', '--force-execute', JSON.parse(occ('background-job:list', '--output=json', '--class=OCA\\VirtualOffice\\BackgroundJob\\PairRoulette'))[0].id)
		const [forAlice] = ((await alice.call('GET', NOTIFICATIONS)).data as any[]).filter((n) => n.app === 'virtualoffice')
		expect(forAlice.subject).toBe('Coffee roulette: meet Bảo this week')
		expect(forAlice.link).toContain('/apps/spreed/?callUser=bao#direct-call')
		const [forBao] = ((await bao.call('GET', NOTIFICATIONS)).data as any[]).filter((n) => n.app === 'virtualoffice')
		expect(forBao.subject).toBe('Coffee roulette: meet Alice this week')
		expect((await bao.call('DELETE', `/offices/${office.token}/roulette`)).data.joined).toBe(false)
	})

	test('a shared birthday shows with the person, a private one does not', async () => {
		const office = await teamOffice()
		const today = new Date().toISOString().slice(5, 10)
		const USERS = '/ocs/v2.php/cloud/users/bao'
		try {
			expect((await bao.call('PUT', USERS, { key: 'birthdate', value: `1990-${today}` })).status).toBe(200)
			await bao.call('PUT', USERS, { key: 'birthdateScope', value: 'v2-local' })
			const shared = await enter(bao, office.token)
			expect(shared.data.participants.find((p: any) => p.uid === 'bao').birthday).toBe(true)
			await bao.call('POST', `/offices/${office.token}/room/leave`, { session: shared.session })
			await bao.call('PUT', USERS, { key: 'birthdateScope', value: 'v2-private' })
			expect((await enter(bao, office.token)).data.participants.find((p: any) => p.uid === 'bao').birthday).toBe(false)
		} finally {
			await bao.call('PUT', USERS, { key: 'birthdate', value: '' })
		}
	})
})

test.describe('review regressions 1.2', () => {
	const NOTIFICATIONS = '/ocs/v2.php/apps/notifications/api/v2/notifications'

	test('someone removed for now gets no knocks or arrival notifications, and their desk hides', async () => {
		const office = await teamOffice()
		await bao.call('PUT', `/offices/${office.token}/desks/d2`)
		await bao.call('PUT', `/offices/${office.token}/watch`, { expiresAt: Date.now() + 3_600_000 })
		await bao.call('DELETE', NOTIFICATIONS)
		expect((await alice.call('PUT', `/offices/${office.token}/removals`, { uid: 'bao', minutes: 15 })).status).toBe(200)

		expect((await alice.call('GET', `/offices/${office.token}/desks`)).data.desks).toEqual([])
		expect((await alice.call('POST', `/offices/${office.token}/knocks`, { uid: 'bao' })).data.code).toBe('PERSON_UNAVAILABLE')
		await enter(alice, office.token)
		expect(((await bao.call('GET', NOTIFICATIONS)).data as any[]).filter((n) => n.app === 'virtualoffice')).toEqual([])

		// The desk comes back with the person.
		await alice.call('DELETE', `/offices/${office.token}/removals`, { uid: 'bao' })
		expect((await alice.call('GET', `/offices/${office.token}/desks`)).data.desks.map((d: any) => d.uid)).toEqual(['bao'])
	})

	test('the directory finds conversation offices from the user\'s own conversations', async () => {
		const TALK = '/ocs/v2.php/apps/spreed/api/v4'
		const room = await alice.call('POST', `${TALK}/room`, { roomType: 2, roomName: uniqueName('Old retro') })
		await alice.call('POST', `${TALK}/room/${room.data.token}/participants`, { newParticipant: 'bao', source: 'users' })
		const office = (await bao.call('POST', `/conversations/${room.data.token}/office`)).data.office
		const listed = async (api: Api) => ((await api.call('POST', '/offices/directory', { search: office.title, conversations: [room.data.token] })).data as any[]).map((o) => o.token)
		expect(await listed(bao)).toEqual([office.token])
		// Tokens come from the browser; someone outside the conversation still sees nothing.
		expect(await listed(chi)).toEqual([])
		expect((await bao.call('POST', '/offices/directory', { conversations: 'nope' })).status).toBe(422)
	})
})

/** Walks someone along the shortest path and waits until they arrive. */
async function walk(api: Api, token: string, s: string, layoutId: string, from: Cell, to: Cell): Promise<void> {
	const path = findPath(getLayout(layoutId), from, to)!
	const moved = await api.call('POST', `/offices/${token}/room/move`, { session: s, path })
	expect(moved.status).toBe(200)
	await new Promise((r) => setTimeout(r, path.length * 250 + 150))
}

const startOf = (snapshot: any, uid: string): Cell => snapshot.participants.find((p: any) => p.uid === uid).trajectory.points[0]

test.describe('1.1: layouts, music, voice and time zones', () => {
	test('an office gets a layout, which changes only while nobody is inside', async () => {
		const small = await alice.call('POST', '/offices', { title: uniqueName('Small'), audience: { kind: 'team', id: teamId }, layoutId: 'compact-office-v1' })
		expect(small.status).toBe(201)
		expect(small.data).toMatchObject({ layoutId: 'compact-office-v1', capacity: 12 })
		expect((await alice.call('POST', '/offices', { title: 'Castle', audience: { kind: 'team', id: teamId }, layoutId: 'castle-v1' })).status).toBe(422)
		const large = await teamOffice()
		expect(large).toMatchObject({ layoutId: 'starter-office-v1', capacity: 32 })

		const inside = await enter(bao, large.token)
		expect(inside.data).toMatchObject({ layoutId: 'starter-office-v1', capacity: 32 })
		await bao.call('PUT', `/offices/${large.token}/desks/d10`)
		await alice.call('PUT', `/offices/${large.token}/desks/d2`)
		const busy = await alice.call('PATCH', `/offices/${large.token}`, { layoutId: 'compact-office-v1' }, { 'If-Match': `"${large.revision}"` })
		expect(busy.status).toBe(422)
		expect(busy.data.code).toBe('INVALID_INPUT')
		expect(busy.data.message).toBe('Change the layout when nobody is inside')

		await bao.call('POST', `/offices/${large.token}/room/leave`, { session: inside.session })
		const changed = await alice.call('PATCH', `/offices/${large.token}`, { layoutId: 'compact-office-v1' }, { 'If-Match': `"${large.revision}"` })
		expect(changed.status).toBe(200)
		expect(changed.data).toMatchObject({ layoutId: 'compact-office-v1', capacity: 12 })
		// Desk 10 does not exist in the small office; desk 2 does.
		expect((await alice.call('GET', `/offices/${large.token}/desks`)).data.desks.map((d: any) => d.deskId)).toEqual(['d2'])
		expect((await bao.call('PUT', `/offices/${large.token}/desks/d10`)).status).toBe(422)
		const back = await enter(bao, large.token)
		expect(back.data).toMatchObject({ layoutId: 'compact-office-v1', capacity: 12 })
		// The first one in arrives at the coffee corner of the small map.
		expect(startOf(back.data, 'bao')).toEqual(getLayout('compact-office-v1').zoneAnchors.coffee)
	})

	test('music plays the starter\'s own file to people inside, seekable, until the starter leaves', async () => {
		const office = await teamOffice()
		const fileId = await upload(alice, 'alice', `office-song-${session().slice(0, 6)}.wav`, toneWav(), 'audio/wav')
		const notAudio = await upload(alice, 'alice', `notes-${session().slice(0, 6)}.txt`, Buffer.from('hello'), 'text/plain')
		const a = await enter(alice, office.token)
		const tracks = [{ fileId, durationMs: 4000 }]
		expect((await alice.call('POST', `/offices/${office.token}/room/music`, { session: a.session, tracks })).data.code).toBe('OUT_OF_REACH')
		await walk(alice, office.token, a.session, 'starter-office-v1', startOf(a.data, 'alice'), [11, 2])
		expect((await alice.call('POST', `/offices/${office.token}/room/music`, { session: a.session, tracks: [{ fileId: notAudio, durationMs: 4000 }] })).data.message).toBe('Choose audio files')
		// Bảo cannot play a file of Alice's.
		const b = await enter(bao, office.token)
		const started = await alice.call('POST', `/offices/${office.token}/room/music`, { session: a.session, tracks })
		expect(started.status).toBe(200)
		expect(started.data.music).toMatchObject({ uid: 'alice', name: 'Alice', tracks: [{ title: expect.stringMatching(/^office-song-/), durationMs: 4000 }] })
		expect(JSON.stringify(started.data)).not.toContain(String(fileId))
		const polled = await bao.call('GET', `/offices/${office.token}/room?session=${b.session}&rev=0`)
		expect(polled.data.music.uid).toBe('alice')

		const url = `/index.php/apps/virtualoffice/o/${office.token}/music/0`
		const whole = await bao.raw('GET', url)
		expect(whole.status()).toBe(200)
		expect(whole.headers()['content-type']).toBe('audio/wav')
		expect(whole.headers()['accept-ranges']).toBe('bytes')
		expect((await whole.body()).length).toBe(toneWav().length)
		const part = await bao.raw('GET', url, { Range: 'bytes=44-143' })
		expect(part.status()).toBe(206)
		expect(part.headers()['content-range']).toBe(`bytes 44-143/${toneWav().length}`)
		expect((await part.body()).equals(toneWav().subarray(44, 144))).toBe(true)
		expect((await bao.raw('GET', url, { Range: 'bytes=999999-' })).status()).toBe(416)
		expect((await bao.raw('GET', `/index.php/apps/virtualoffice/o/${office.token}/music/1`)).status()).toBe(404)
		// Outside the office, or outside its audience: nothing.
		expect((await chi.raw('GET', url)).status()).toBe(404)
		await bao.call('POST', `/offices/${office.token}/room/leave`, { session: b.session })
		expect((await bao.raw('GET', url)).status()).toBe(404)

		// The music is Alice's file: it stops when she leaves.
		const again = await enter(bao, office.token)
		await alice.call('POST', `/offices/${office.token}/room/leave`, { session: a.session })
		expect((await bao.raw('GET', url)).status()).toBe(404)
		expect((await bao.call('GET', `/offices/${office.token}/room?session=${again.session}&rev=0`)).data.music).toBeNull()
	})

	for (const how of ['she comes back', 'someone else polls', 'the background job runs']) {
		test(`music stops when its owner's visit times out and ${how}`, async () => {
			const office = await teamOffice()
			const fileId = await upload(alice, 'alice', `timeout-${session().slice(0, 6)}.wav`, toneWav(2), 'audio/wav')
			const a = await enter(alice, office.token)
			await walk(alice, office.token, a.session, 'starter-office-v1', startOf(a.data, 'alice'), [11, 2])
			expect((await alice.call('POST', `/offices/${office.token}/room/music`, { session: a.session, tracks: [{ fileId, durationMs: 2000 }] })).status).toBe(200)
			const b = await enter(bao, office.token)
			// Alice's heartbeats stopped, for example in a background tab.
			sql(`UPDATE oc_vo_presence SET lease_until = 1 WHERE session = '${a.session}'`)
			if (how === 'she comes back') {
				const back = await enter(alice, office.token)
				expect(back.status).toBe(200)
				expect(back.data.participants.map((p: any) => p.uid).sort()).toEqual(['alice', 'bao'])
				expect(back.data.music).toBeNull()
			} else if (how === 'someone else polls') {
				expect((await bao.call('GET', `/offices/${office.token}/room?session=${b.session}&rev=0`)).data.music).toBeNull()
			} else {
				occ('background-job:execute', '--force-execute', sql("SELECT id FROM oc_jobs WHERE class = 'OCA\\VirtualOffice\\BackgroundJob\\ExpirePresence'"))
			}
			expect(sql(`SELECT room_state FROM oc_vo_offices WHERE token = '${office.token}'`)).toContain('"music":null')
			expect((await bao.raw('GET', `/index.php/apps/virtualoffice/o/${office.token}/music/0`)).status()).toBe(404)
		})
	}

	test('anyone at the player stops the music', async () => {
		const office = await teamOffice()
		const fileId = await upload(alice, 'alice', `stop-song-${session().slice(0, 6)}.wav`, toneWav(2), 'audio/wav')
		const a = await enter(alice, office.token)
		await walk(alice, office.token, a.session, 'starter-office-v1', startOf(a.data, 'alice'), [11, 2])
		await alice.call('POST', `/offices/${office.token}/room/music`, { session: a.session, tracks: [{ fileId, durationMs: 2000 }] })
		const b = await enter(bao, office.token)
		expect((await bao.call('POST', `/offices/${office.token}/room/music/stop`, { session: b.session })).data.code).toBe('OUT_OF_REACH')
		await walk(bao, office.token, b.session, 'starter-office-v1', startOf(b.data, 'bao'), [13, 3])
		const stopped = await bao.call('POST', `/offices/${office.token}/room/music/stop`, { session: b.session })
		expect(stopped.status).toBe(200)
		expect(stopped.data.music).toBeNull()
		expect((await bao.raw('GET', `/index.php/apps/virtualoffice/o/${office.token}/music/0`)).status()).toBe(404)
	})

	test('voice signals go only between tabs with voice on, by push and poll', async () => {
		const office = await teamOffice()
		const a = await enter(alice, office.token)
		const b = await enter(bao, office.token)
		const offer = { type: 'offer', sdp: 'v=0\r\n' }
		expect((await alice.call('POST', `/offices/${office.token}/room/signal`, { session: a.session, to: b.session, body: offer })).data.code).toBe('ACTION_DENIED')
		const on = await alice.call('POST', `/offices/${office.token}/room/voice`, { session: a.session, on: true })
		expect(on.data.participant.voice).toBe(a.session)
		expect((await alice.call('POST', `/offices/${office.token}/room/signal`, { session: a.session, to: b.session, body: offer })).data.code).toBe('PERSON_UNAVAILABLE')
		await bao.call('POST', `/offices/${office.token}/room/voice`, { session: b.session, on: true })
		const polled = await bao.call('GET', `/offices/${office.token}/room?session=${b.session}&rev=0`)
		expect(polled.data.participants.find((p: any) => p.uid === 'alice').voice).toBe(a.session)
		expect(polled.data.voiceAllowed).toBe(true)

		for (const bad of [{ type: 'candidate', sdp: 'x' }, { type: 'offer', sdp: 'x'.repeat(16_400) }, { type: 'bye', extra: 1 }, 'offer']) {
			expect((await alice.call('POST', `/offices/${office.token}/room/signal`, { session: a.session, to: b.session, body: bad })).status).toBe(422)
		}
		const sent = await alice.call('POST', `/offices/${office.token}/room/signal`, { session: a.session, to: b.session, body: offer })
		expect(sent.status).toBe(200)
		const first = await bao.call('GET', `/offices/${office.token}/room?session=${b.session}&rev=${polled.data.rev}`)
		expect(first.data.signals).toEqual([{ id: sent.data.id, from: a.session, body: offer }])
		const second = await bao.call('GET', `/offices/${office.token}/room?session=${b.session}&rev=${polled.data.rev}`)
		expect(second.data.signals).toBeUndefined()

		// Someone outside the office cannot signal into it.
		expect((await chi.call('POST', `/offices/${office.token}/room/signal`, { session: session(), to: b.session, body: offer })).data.code).toBe('NOT_PRESENT')
		// Signals left for a tab are dropped when it leaves.
		await alice.call('POST', `/offices/${office.token}/room/signal`, { session: a.session, to: b.session, body: { type: 'bye' } })
		await bao.call('POST', `/offices/${office.token}/room/leave`, { session: b.session })
		expect(sql(`SELECT count(*) FROM oc_vo_signals WHERE to_session = '${b.session}'`)).toBe('0')

		try {
			const before = (await alice.call('GET', `/offices/${office.token}/room?session=${a.session}&rev=0`)).data.rev
			await admin.call('PUT', '/admin/settings', { voice: false })
			// Everyone inside learns at once, also by polling.
			const told = await alice.call('GET', `/offices/${office.token}/room?session=${a.session}&rev=${before}`)
			expect(told.data).toMatchObject({ changed: true, voiceAllowed: false })
			const b2 = await enter(bao, office.token)
			expect((await bao.call('POST', `/offices/${office.token}/room/voice`, { session: b2.session, on: true })).data.code).toBe('ACTION_DENIED')
			// Alice still had voice on: her signals stop, and her browser sees voice is no longer allowed.
			expect((await alice.call('POST', `/offices/${office.token}/room/signal`, { session: a.session, to: b2.session, body: offer })).data.code).toBe('ACTION_DENIED')
			expect((await alice.call('GET', `/offices/${office.token}/room?session=${a.session}&rev=0`)).data.voiceAllowed).toBe(false)
			expect((await alice.call('POST', `/offices/${office.token}/room/voice`, { session: a.session, on: false })).data.participant.voice).toBeNull()
		} finally {
			await admin.call('PUT', '/admin/settings', { voice: true })
		}
	})

	test('members see each other\'s time zone and working hours', async () => {
		const office = await teamOffice()
		const AVAILABILITY = "DELETE FROM oc_properties WHERE userid = 'bao' AND propertyname = '{urn:ietf:params:xml:ns:caldav}calendar-availability'"
		sql(AVAILABILITY)
		occ('user:setting', 'bao', 'core', 'timezone', 'Asia/Ho_Chi_Minh')
		occ('user:setting', 'chi', 'core', 'timezone', 'America/New_York')
		await enter(alice, office.token)
		await bao.call('PUT', `/offices/${office.token}/desks/d3`)
		const times = (await alice.call('GET', `/offices/${office.token}/desks`)).data.times
		expect(Object.keys(times).sort()).toEqual(['alice', 'bao'])
		expect(times.bao).toMatchObject({ timeZone: 'Asia/Ho_Chi_Minh', hours: { timeZone: 'Asia/Ho_Chi_Minh', default: true, days: { 1: [[540, 1020]], 6: [] } } })
		// Personal settings › Availability, saved like the dav app does.
		const availability = 'BEGIN:VCALENDAR\r\nPRODID:Nextcloud DAV app\r\nBEGIN:VAVAILABILITY\r\nBEGIN:AVAILABLE\r\nDTSTART;TZID=Asia/Ho_Chi_Minh:20240101T080000\r\nDTEND;TZID=Asia/Ho_Chi_Minh:20240101T120000\r\nUID:e2e\r\nRRULE:FREQ=WEEKLY;BYDAY=MO,WE\r\nEND:AVAILABLE\r\nEND:VAVAILABILITY\r\nEND:VCALENDAR\r\n'
		const patch = await bao.raw(
			'PROPPATCH',
			'/remote.php/dav/calendars/bao/inbox',
			{ 'Content-Type': 'application/xml' },
			`<?xml version="1.0"?><d:propertyupdate xmlns:d="DAV:"><d:set><d:prop><c:calendar-availability xmlns:c="urn:ietf:params:xml:ns:caldav">${availability.replace(/\r\n/g, '&#13;\n')}</c:calendar-availability></d:prop></d:set></d:propertyupdate>`,
		)
		expect(patch.status()).toBe(207)
		try {
			const hours = (await alice.call('GET', `/offices/${office.token}/desks`)).data.times.bao.hours
			expect(hours).toEqual({ timeZone: 'Asia/Ho_Chi_Minh', default: false, days: { 1: [[480, 720]], 2: [], 3: [[480, 720]], 4: [], 5: [], 6: [], 7: [] } })
		} finally {
			sql(AVAILABILITY)
		}
	})
})
