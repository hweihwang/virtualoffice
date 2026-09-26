/**
 * SPDX-FileCopyrightText: 2026 Hoang Pham
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Smoke test for a freshly installed release archive: node smoke.mjs <base-url>
 * Expects users alice, bao, chi and dan (password below) and alice, bao and dan in group "staff".
 */
import { randomBytes } from 'node:crypto'

const base = process.argv[2]
const password = 'virtualoffice-fixture-only'
let failures = 0

async function call(user, method, path, body) {
	const response = await fetch(`${base}/ocs/v2.php/apps/virtualoffice/api/v1${path}`, {
		method,
		headers: {
			Authorization: 'Basic ' + Buffer.from(`${user}:${password}`).toString('base64'),
			'OCS-APIRequest': 'true',
			Accept: 'application/json',
			'Content-Type': 'application/json',
		},
		body: body === undefined ? undefined : JSON.stringify(body),
	})
	const json = await response.json().catch(() => ({}))
	return { status: response.status, data: json?.ocs?.data }
}

function check(label, condition) {
	console.log(`${condition ? 'ok  ' : 'FAIL'} ${label}`)
	if (!condition) {
		failures++
	}
}

const session = () => randomBytes(16).toString('hex')
for (let i = 0; i < 30 && (await call('alice', 'GET', '/offices')).status !== 200; i++) {
	await new Promise((resolve) => setTimeout(resolve, 1000))
}
const office = await call('admin', 'POST', '/offices', { title: 'Smoke office', audience: { kind: 'group', id: 'staff' }, managerUid: 'alice' })
check('admin creates a group office', office.status === 201)
const token = office.data.token
check('outsider gets 404', (await call('chi', 'GET', `/offices/${token}`)).status === 404)

const a = session()
const b = session()
const aliceIn = await call('alice', 'POST', `/offices/${token}/room/enter`, { session: a })
check('alice enters', aliceIn.status === 200)
check('bao enters', (await call('bao', 'POST', `/offices/${token}/room/enter`, { session: b })).status === 200)
check('second window is refused', (await call('alice', 'POST', `/offices/${token}/room/enter`, { session: session() })).data?.code === 'ACTIVE_ELSEWHERE')

const [x, y] = aliceIn.data.participants.find((p) => p.uid === 'alice').trajectory.points[0]
const moved = await call('alice', 'POST', `/offices/${token}/room/move`, { session: a, path: [[x, y], [x, y - 1], [x, y - 2]] })
check('alice walks with server timing', moved.status === 200 && moved.data.participant.trajectory.arriveAt[2] - moved.data.participant.trajectory.arriveAt[1] === 250)
check('invalid path is rejected', (await call('alice', 'POST', `/offices/${token}/room/move`, { session: a, path: [[1, 1], [3, 1]] })).status === 422)

const poll = await call('bao', 'GET', `/offices/${token}/room?session=${b}&rev=0`)
check('bao sees two people', poll.data?.participants?.length === 2)
const again = await call('bao', 'GET', `/offices/${token}/room?session=${b}&rev=${poll.data.rev}`)
check('unchanged room answers briefly', again.data?.changed === false)

await call('admin', 'PUT', '/admin/settings', { roomCapacity: 2 })
check('full office refuses a third person', (await call('dan', 'POST', `/offices/${token}/room/enter`, { session: session() })).data?.code === 'ROOM_FULL')
const removed = await call('alice', 'PUT', `/offices/${token}/removals`, { uid: 'bao', minutes: 15 })
check('manager removes bao', removed.status === 200)
check('bao cannot come back yet', (await call('bao', 'POST', `/offices/${token}/room/enter`, { session: session() })).data?.code === 'OFFICE_REMOVED')
await call('admin', 'PUT', '/admin/settings', { roomCapacity: 32 })

check('alice leaves', (await call('alice', 'POST', `/offices/${token}/room/leave`, { session: a })).status === 200)
check('office is empty', (await call('alice', 'GET', `/offices/${token}`)).data?.count === 0)
check('manager deletes the office', (await call('alice', 'DELETE', `/offices/${token}`, undefined)).status === 428)

process.exitCode = failures === 0 ? 0 : 1
console.log(failures === 0 ? 'Smoke test passed' : `${failures} checks failed`)
