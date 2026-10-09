/**
 * SPDX-FileCopyrightText: 2026 Hoang Pham
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Real Safari against Chromium: both near the office's record player must
 * play the same moment, or one room hears an echo. Playwright's WebKit
 * covers the engine; this checks Safari itself, through AppleScript.
 *
 * macOS only. Turn on Safari › Settings › Developer › Allow JavaScript from
 * Apple Events, start the push fixture, then: node tests/safari/music-sync.mjs
 * Safari plays sound only after a real click, so click Enter office when asked.
 */
import { chromium } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { resolve } from 'node:path'

const BASE = 'http://localhost:18935'
const PASS = 'virtualoffice-fixture-only'
const compose = resolve(import.meta.dirname, '../fixture/compose.yaml')
const occ = (...args) => execFileSync('docker', ['compose', '-f', compose, 'exec', '-T', '-u', 'www-data', 'app', 'php', 'occ', ...args], { encoding: 'utf8' })
const auth = (user) => ({ Authorization: 'Basic ' + Buffer.from(`${user}:${PASS}`).toString('base64'), 'OCS-APIRequest': 'true', Accept: 'application/json' })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// A Team office for Alice and Bảo, and a minute of clicks in Alice's Files.
const team = JSON.parse(occ('circles:manage:create', '--type', 'user', '--output=json', 'alice', `Safari sync ${randomBytes(3).toString('hex')}`)).id
occ('circles:members:add', '--type', 'user', team, 'bao')
const office = (await (await fetch(`${BASE}/ocs/v2.php/apps/virtualoffice/api/v1/offices`, { method: 'POST', headers: { ...auth('alice'), 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'Safari sync', audience: { kind: 'team', id: team } }) })).json()).ocs.data
const name = `safari-sync-${randomBytes(3).toString('hex')}.wav`
/** A minute of short clicks, two per second, as a mono WAV. */
function clicks() {
	const rate = 8000
	const samples = 60 * rate
	const wav = Buffer.alloc(44 + samples * 2)
	wav.write('RIFF', 0)
	wav.writeUInt32LE(36 + samples * 2, 4)
	wav.write('WAVEfmt ', 8)
	wav.writeUInt32LE(16, 16)
	wav.writeUInt16LE(1, 20)
	wav.writeUInt16LE(1, 22)
	wav.writeUInt32LE(rate, 24)
	wav.writeUInt32LE(rate * 2, 28)
	wav.writeUInt16LE(2, 32)
	wav.writeUInt16LE(16, 34)
	wav.write('data', 36)
	wav.writeUInt32LE(samples * 2, 40)
	for (let i = 0; i < samples; i++) {
		wav.writeInt16LE(i % (rate / 2) < 300 ? Math.round(Math.sin(2 * Math.PI * 1200 * i / rate) * 12000) : 0, 44 + i * 2)
	}
	return wav
}
const wav = clicks()
await fetch(`${BASE}/remote.php/dav/files/alice/${name}`, { method: 'PUT', headers: auth('alice'), body: wav })

// Safari through AppleScript, in a window of its own.
const osa = (script) => execFileSync('osascript', ['-e', script], { encoding: 'utf8' }).trim()
const quote = (text) => '"' + text.replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('\n', '\\n') + '"'
const open = (url) => osa(`tell application "Safari" to set URL of front document to ${quote(url)}`)
/** Runs a function body in Safari's page and returns its result. */
function run(body) {
	const out = osa(`tell application "Safari" to do JavaScript ${quote(`JSON.stringify((() => { ${body} })())`)} in front document`)
	return out === '' || out === 'missing value' ? null : JSON.parse(out)
}
async function waitFor(body, timeout = 20_000) {
	for (const until = Date.now() + timeout; Date.now() < until; await sleep(250)) {
		// Fails while a page loads.
		if (await Promise.resolve().then(() => run(body)).catch(() => false)) {
			return
		}
	}
	throw new Error(`Timed out: ${body}`)
}
osa('tell application "Safari" to make new document')
/** Position of the office's music now, minus the output latency, with the time it was read. */
const POSITION = `
	const m = [...(window.__media ?? [])].find((x) => !x.srcObject && x.src !== '' && !x.paused)
	if (!m) return null
	const c = new AudioContext(); const latency = c.outputLatency || c.baseLatency || 0; c.close()
	return { at: Date.now(), heard: m.currentTime - latency }`
const HOOK = 'window.__media = new Set(); const play = HTMLMediaElement.prototype.play; HTMLMediaElement.prototype.play = function () { window.__media.add(this); return play.call(this) }'

const browser = await chromium.launch()
try {
	// Alice in Chromium starts the music at the player.
	const context = await browser.newContext({ baseURL: BASE })
	await context.addInitScript(HOOK)
	const alice = await context.newPage()
	await alice.goto('/login')
	await alice.locator('#user').fill('alice')
	await alice.locator('#password').fill(PASS)
	await alice.locator('button[type=submit]').click()
	await alice.waitForURL(/\/apps\//)
	await alice.goto(`/index.php/apps/virtualoffice/o/${office.token}`)
	await alice.getByRole('button', { name: 'Enter office' }).click()
	const common = alice.locator('.people__zone').filter({ has: alice.getByRole('heading', { name: /Common room/ }) })
	await common.getByRole('button', { name: 'Play music' }).click()
	const picker = alice.getByRole('dialog', { name: 'Choose music to play for the office' })
	await picker.getByRole('row', { name: new RegExp(name.replace('.wav', '')) }).click()
	await picker.getByRole('button', { name: 'Play' }).click()
	await common.getByText(/Now playing/).waitFor({ timeout: 20_000 })
	await sleep(3000)

	// Bảo in Safari arrives next to Alice and hears it.
	open(`${BASE}/login`)
	await waitFor('return document.readyState === "complete" && (!!document.querySelector("#user") || location.pathname.includes("/apps/"))')
	if (run('return !!document.querySelector("#user")')) {
		run(`const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
			for (const [id, value] of [['#user', 'bao'], ['#password', '${PASS}']]) { const input = document.querySelector(id); set.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })) }
			document.querySelector('button[type=submit]').click()`)
		await waitFor('return location.pathname.includes("/apps/")')
	}
	if (run('return OC.getCurrentUser().uid') !== 'bao') {
		throw new Error('Safari is logged in as someone else; log out there first')
	}
	open(`${BASE}/index.php/apps/virtualoffice/o/${office.token}`)
	await waitFor('return [...document.querySelectorAll("button")].some((b) => b.textContent.includes("Enter office"))')
	run(HOOK)
	console.log('Click Enter office in Safari.')
	await waitFor(`${POSITION.replace(/return \{[^}]*\}/, 'return true')}`, 120_000)
	await sleep(8000)

	const spreads = []
	for (let i = 0; i < 8; i++) {
		const [a, b] = await Promise.all([alice.evaluate(new Function(POSITION)), run(POSITION)])
		// Bring both readings to the same moment.
		const t = Math.max(a.at, b.at)
		const spread = Math.abs((a.heard + (t - a.at) / 1000) - (b.heard + (t - b.at) / 1000))
		spreads.push(spread)
		console.log(`chromium ${a.heard.toFixed(3)} s, safari ${b.heard.toFixed(3)} s, apart ${(spread * 1000).toFixed(0)} ms`)
		await sleep(1000)
	}
	const worst = Math.max(...spreads)
	console.log(worst >= 0.06 ? `FAIL: up to ${(worst * 1000).toFixed(0)} ms apart` : `ok: Safari and Chromium within ${(worst * 1000).toFixed(0)} ms`)
	process.exitCode = worst >= 0.06 ? 1 : 0
} finally {
	await browser.close()
	osa(`tell application "Safari" to close (every document whose URL contains ${quote(office.token)})`)
}
