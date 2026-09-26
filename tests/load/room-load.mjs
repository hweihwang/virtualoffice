/**
 * SPDX-FileCopyrightText: 2026 Hoang Pham
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Load test against the fixture: N signed-in people in one office, each
 * polling (or sending heartbeats when Client Push is on) and walking now and
 * then. Reports request latency, errors and the Nextcloud container's CPU.
 *
 * Usage: node tests/load/room-load.mjs [--people 32] [--seconds 60] [--mode polling|push] [--walk-every 5]
 */
import { execFileSync, spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { resolve } from 'node:path'

const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, value, i, all) => (value.startsWith('--') ? [...pairs, [value.slice(2), all[i + 1]]] : pairs), []))
const BASE = process.env.VO_BASE_URL ?? 'http://localhost:18935'
const PEOPLE = Number(args.people ?? 32)
const SECONDS = Number(args.seconds ?? 60)
const MODE = args.mode ?? 'polling'
const WALK_EVERY = Number(args['walk-every'] ?? 5) * 1000
const POLL_EVERY = MODE === 'push' ? 5000 : 1200
const PASSWORD = 'virtualoffice-fixture-only'
const COMPOSE = resolve(import.meta.dirname, '../fixture/compose.yaml')

class Client {
	constructor(uid) {
		this.uid = uid
		this.cookies = new Map()
		this.requestToken = ''
	}

	async fetch(path, options = {}) {
		const headers = { Origin: BASE, ...options.headers, Cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ') }
		const response = await fetch(BASE + path, { ...options, headers, redirect: 'manual' })
		for (const cookie of response.headers.getSetCookie()) {
			const [pair] = cookie.split(';')
			const [name, value] = pair.split('=')
			this.cookies.set(name.trim(), value)
		}
		return response
	}

	async login() {
		const page = await (await this.fetch('/index.php/login')).text()
		this.requestToken = page.match(/data-requesttoken="([^"]+)"/)[1]
		const body = new URLSearchParams({ user: this.uid, password: PASSWORD, requesttoken: this.requestToken, timezone: 'UTC', timezone_offset: '0' })
		await this.fetch('/index.php/login', { method: 'POST', body, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } })
		const app = await (await this.fetch('/index.php/apps/virtualoffice/')).text()
		this.requestToken = app.match(/data-requesttoken="([^"]+)"/)[1]
	}

	async ocs(method, path, data) {
		const started = performance.now()
		const response = await this.fetch(`/ocs/v2.php/apps/virtualoffice/api/v1${path}`, {
			method,
			headers: { 'OCS-APIRequest': 'true', Accept: 'application/json', 'Content-Type': 'application/json', requesttoken: this.requestToken },
			body: data === undefined || method === 'GET' ? undefined : JSON.stringify(data),
		})
		const json = await response.json().catch(() => null)
		return { status: response.status, data: json?.ocs?.data, ms: performance.now() - started }
	}
}

const stats = new Map()
function record(kind, result) {
	const entry = stats.get(kind) ?? { times: [], errors: 0, statuses: {} }
	entry.times.push(result.ms)
	entry.statuses[result.status] = (entry.statuses[result.status] ?? 0) + 1
	if (result.status >= 500 || result.status === 0) {
		entry.errors++
	}
	stats.set(kind, entry)
}

function percentile(values, p) {
	const sorted = [...values].sort((a, b) => a - b)
	return sorted.length ? Math.round(sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]) : null
}

const cpuSamples = []
function sampleCpu() {
	const stats = spawn('docker', ['stats', '--no-stream', '--format', '{{.Name}} {{.CPUPerc}} {{.MemUsage}}'])
	let out = ''
	stats.stdout.on('data', (d) => {
		out += d
	})
	stats.on('close', () => {
		const line = out.split('\n').find((l) => l.includes('virtualoffice-validation-app'))
		if (line) {
			cpuSamples.push(Number.parseFloat(line.split(' ')[1]))
		}
	})
}

const admin = new Client('vo_admin')
await admin.login()
const office = await admin.ocs('POST', '/offices', { title: `Load ${randomBytes(3).toString('hex')}`, audience: { kind: 'group', id: 'virtualoffice-load' }, managerUid: 'load01' })
if (office.status !== 201) {
	throw new Error(`Could not create the office: ${office.status}`)
}
execFileSync('docker', ['compose', '-f', COMPOSE, 'exec', '-T', 'database', 'psql', '-U', 'virtualoffice_fixture', '-d', 'virtualoffice_fixture', '-qc', 'DELETE FROM oc_vo_presence'])
const token = office.data.token

const clients = await Promise.all(Array.from({ length: PEOPLE }, async (_, i) => {
	const client = new Client(`load${String(i + 1).padStart(2, '0')}`)
	await client.login()
	return client
}))

const deadline = Date.now() + SECONDS * 1000
const cpuTimer = setInterval(sampleCpu, 2000)

await Promise.all(clients.map(async (client, i) => {
	const session = randomBytes(16).toString('hex')
	const entered = await client.ocs('POST', `/offices/${token}/room/enter`, { session })
	record('enter', entered)
	if (entered.status !== 200) {
		return
	}
	let rev = entered.data.rev
	let me = entered.data.participants.find((p) => p.uid === client.uid)
	let nextWalk = Date.now() + Math.random() * WALK_EVERY
	await new Promise((r) => setTimeout(r, Math.random() * POLL_EVERY))
	while (Date.now() < deadline) {
		if (Date.now() >= nextWalk && me) {
			const [x, y] = me.trajectory.points.at(-1)
			const cell = [Math.round(x), Math.round(y)]
			const step = i % 2 === 0 ? -1 : 1
			const path = [cell]
			for (let k = 1; k <= 3; k++) {
				path.push([cell[0], cell[1] + (y > 12 ? -k : k) * (step > 0 ? 1 : 1)])
			}
			const moved = await client.ocs('POST', `/offices/${token}/room/move`, { session, path })
			record('move', moved)
			if (moved.status === 200) {
				me = moved.data.participant
			}
			nextWalk = Date.now() + WALK_EVERY
		}
		const polled = await client.ocs('GET', `/offices/${token}/room?session=${session}&rev=${rev}`)
		record(polled.data?.changed ? 'poll (changed)' : 'poll (unchanged)', polled)
		if (polled.status === 200) {
			rev = polled.data.rev
			if (polled.data.changed) {
				me = polled.data.participants.find((p) => p.uid === client.uid) ?? me
			}
		}
		await new Promise((r) => setTimeout(r, POLL_EVERY))
	}
	record('leave', await client.ocs('POST', `/offices/${token}/room/leave`, { session }))
}))
clearInterval(cpuTimer)
await new Promise((r) => setTimeout(r, 2500))

const total = [...stats.values()].reduce((sum, s) => sum + s.times.length, 0)
const summary = {
	mode: MODE,
	people: PEOPLE,
	seconds: SECONDS,
	requestsPerSecond: Math.round((total / SECONDS) * 10) / 10,
	appCpuPercent: { mean: Math.round(cpuSamples.reduce((a, b) => a + b, 0) / Math.max(1, cpuSamples.length)), max: Math.round(Math.max(0, ...cpuSamples)) },
	requests: Object.fromEntries([...stats].map(([kind, s]) => [kind, { count: s.times.length, p50: percentile(s.times, 0.5), p95: percentile(s.times, 0.95), p99: percentile(s.times, 0.99), errors: s.errors, statuses: s.statuses }])),
}
console.log(JSON.stringify(summary, null, 2))
if ([...stats.values()].some((s) => s.errors > 0)) {
	process.exitCode = 1
}
