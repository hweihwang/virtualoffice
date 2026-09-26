/**
 * SPDX-FileCopyrightText: 2026 Hoang Pham
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Stages a lively office on a fresh push fixture and captures the
 * screenshots for the README, the App Store and the landing page into
 * build/marketing/. Run it through scripts/marketing/build.sh.
 */
import { chromium, request } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdirSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '../..')
const out = resolve(root, 'build/marketing')
const api = 'http://localhost:18935'
// Browsers reach the fixture through a TLS proxy under an example host name,
// so no screenshot shows localhost.
const web = 'https://cloud.example.com'
const pass = 'virtualoffice-fixture-only'
const TILE = 40

rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })

function occ(...args) {
	return execFileSync('docker', ['compose', '-f', resolve(root, 'tests/fixture/compose.yaml'), 'exec', '-T', '-u', 'www-data', '-e', `NC_PASS=${pass}`, 'app', 'php', 'occ', ...args], { encoding: 'utf8' })
}

async function as(user) {
	const ctx = await request.newContext({ baseURL: api, extraHTTPHeaders: { Authorization: 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64'), 'OCS-APIRequest': 'true', Accept: 'application/json' } })
	return async (method, path, data, headers = {}) => {
		const response = await ctx.fetch(path.startsWith('/ocs/') ? path : `/ocs/v2.php/apps/virtualoffice/api/v1${path}`, { method, data, headers: { 'Content-Type': 'application/json', ...headers } })
		const text = await response.text()
		if (!response.ok()) {
			throw new Error(`${user} ${method} ${path}: ${response.status()} ${text.slice(0, 300)}`)
		}
		return JSON.parse(text).ocs.data
	}
}

// People: the same cast as the film.
for (const [uid, name] of [['dana', 'Dana'], ['emil', 'Emil'], ['fern', 'Fern'], ['gus', 'Gus']]) {
	try {
		occ('user:info', uid)
	} catch {
		occ('user:add', '--password-from-env', '--display-name', name, uid)
	}
}
occ('config:app:set', 'dashboard', 'layout', '--value=virtualoffice,spreed,recommendations')
occ('group:add', '--display-name', 'Design', 'design')
for (const uid of ['alice', 'bao', 'dana', 'fern']) {
	occ('group:adduser', 'design', uid)
}
const people = {
	alice: { creature: 'rabbit', palette: 'rose', accessory: 'scarf' },
	bao: { creature: 'cat', palette: 'sky', accessory: 'flower' },
	chi: { creature: 'bear', palette: 'cocoa', accessory: 'glasses' },
	dana: { creature: 'bird', palette: 'butter', accessory: 'beanie' },
	emil: { creature: 'cat', palette: 'sage', accessory: 'none' },
	fern: { creature: 'bird', palette: 'lilac', accessory: 'flower' },
	gus: { creature: 'bear', palette: 'slate', accessory: 'beanie' },
}
const call = {}
for (const [uid, appearance] of Object.entries(people)) {
	call[uid] = await as(uid)
	await call[uid]('PUT', '/me/preferences', { revision: 0, preferences: { appearance, ui: { view: 'scene', reducedEffects: false, announcements: true } } })
	await call[uid]('PUT', '/ocs/v2.php/apps/user_status/api/v1/user_status/status', { statusType: 'online' })
}
const admin = await as('vo_admin')
const endOfDay = Date.now() + 8 * 3600_000
const members = ['bao', 'chi', 'dana', 'emil', 'fern', 'gus']

// Offices
const team = JSON.parse(occ('circles:manage:create', '--type', 'user', '--output=json', 'alice', 'Studio team'))
for (const uid of members) {
	occ('circles:members:add', '--type', 'user', team.id, uid)
}
const studio = await call.alice('POST', '/offices', { title: 'The Studio', audience: { kind: 'team', id: team.id } })
const chat = await call.alice('POST', '/ocs/v2.php/apps/spreed/api/v4/room', { roomType: 2, roomName: 'Studio chat' })
for (const uid of members) {
	await call.alice('POST', `/ocs/v2.php/apps/spreed/api/v4/room/${chat.token}/participants`, { newParticipant: uid, source: 'users' })
}
await call.alice('PATCH', `/offices/${studio.token}`, { talk: { source: 'link', url: `${web}/call/${chat.token}`, label: 'Studio chat' } }, { 'If-Match': String(studio.revision) })
const design = await admin('POST', '/offices', { title: 'Design corner', audience: { kind: 'group', id: 'design' }, managerUid: 'dana' })
const launch = await call.bao('POST', '/ocs/v2.php/apps/spreed/api/v4/room', { roomType: 2, roomName: 'Launch planning' })
for (const uid of ['alice', 'chi']) {
	await call.bao('POST', `/ocs/v2.php/apps/spreed/api/v4/room/${launch.token}/participants`, { newParticipant: uid, source: 'users' })
}
await call.bao('POST', `/conversations/${launch.token}/office`)

// Dana is out: her desk shows her status and note.
await call.dana('PUT', '/ocs/v2.php/apps/user_status/api/v1/user_status/status', { statusType: 'away' })
await call.dana('PUT', '/ocs/v2.php/apps/user_status/api/v1/user_status/message/custom', { message: 'Back after lunch', statusIcon: '🥪' })
const danaSession = randomBytes(16).toString('hex')
await call.dana('POST', `/offices/${studio.token}/room/enter`, { session: danaSession })
await call.dana('PUT', `/offices/${studio.token}/desks/d7`)
await call.dana('POST', `/offices/${studio.token}/room/leave`, { session: danaSession })
await call.dana('PUT', '/me/today', { text: 'Writing the release notes', expiresAt: endOfDay })
await call.chi('PUT', '/me/today', { text: 'Reviewing the new onboarding', expiresAt: endOfDay })
await call.alice('PUT', '/me/today', { text: 'Launch checklist', expiresAt: endOfDay })

// Chat: Bảo asks, Alice shares the office.
await call.bao('POST', `/ocs/v2.php/apps/spreed/api/v1/chat/${chat.token}`, { message: 'Anyone free for a quick question about the launch?' })
await call.alice('POST', `/ocs/v2.php/apps/spreed/api/v1/chat/${chat.token}`, { message: `Come by the office: ${studio.url}` })

// The full Chromium build: the headless shell quits after about 30 seconds on some machines.
const browser = await chromium.launch({ channel: 'chromium', args: ['--host-resolver-rules=MAP cloud.example.com:443 127.0.0.1:18443'] })
async function open(user, { width = 1440, height = 900, scale = 2, mobile = false } = {}) {
	const context = await browser.newContext({
		baseURL: web,
		ignoreHTTPSErrors: true,
		viewport: { width, height },
		deviceScaleFactor: scale,
		isMobile: mobile,
		hasTouch: mobile,
		// Talk warns about headless browsers it does not recognise.
		userAgent: mobile
			? 'Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Mobile/15E148 Safari/604.1'
			: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36',
	})
	const page = await context.newPage()
	await page.goto('/login')
	await page.locator('#user').fill(user)
	await page.locator('#password').fill(pass)
	await page.locator('button[type=submit]').click()
	await page.waitForURL(/\/apps\//)
	return page
}
async function enter(page, url) {
	if (url) {
		await page.goto(url)
	}
	await page.getByRole('button', { name: 'Enter office' }).click()
	await page.getByRole('button', { name: 'Continue here' }).click({ timeout: 2500 }).catch(() => {})
	await page.locator('.vo-stage').waitFor()
}
async function walk(page, [x, y], scope = page) {
	const box = await scope.locator('.vo-stage').boundingBox()
	const scale = box.width / (32 * TILE)
	await page.mouse.click(box.x + (x * TILE + TILE / 2) * scale, box.y + (y * TILE + TILE / 2) * scale)
}
async function leave(page) {
	await page.getByRole('button', { name: 'Leave', exact: true }).first().click().catch(() => {})
	await page.context().close()
}
const png = (name) => resolve(out, `${name}.png`)
/** An element with some room around it, clipped to the page. */
async function around(page, selector, name, pad = 24) {
	const element = page.locator(selector).first()
	await element.scrollIntoViewIfNeeded()
	const box = await element.boundingBox()
	const size = page.viewportSize()
	const x = Math.max(0, box.x - pad)
	const y = Math.max(0, box.y - pad)
	await page.screenshot({ path: png(name), clip: { x, y, width: Math.min(size.width - x, box.width + 2 * pad), height: Math.min(size.height - y, box.height + 2 * pad) } })
}
/** Only this element and its shadow, on a transparent background. */
async function cutout(page, selector, name, pad = 20) {
	const style = await page.addStyleTag({ content: `html, body { background: transparent !important; } body * { visibility: hidden !important; } ${selector}, ${selector} * { visibility: visible !important; }` })
	const box = await page.locator(selector).first().boundingBox()
	const size = page.viewportSize()
	const x = Math.max(0, box.x - pad)
	const y = Math.max(0, box.y - pad)
	await page.screenshot({ path: png(name), omitBackground: true, clip: { x, y, width: Math.min(size.width - x, box.width + 2 * pad), height: Math.min(size.height - y, box.height + 2 * pad) } })
	await style.evaluate((node) => node.remove())
}

// Everyone but Alice settles in first.
const chi = await open('chi')
const emil = await open('emil', { scale: 1 })
const bao = await open('bao', { scale: 1 })
const fern = await open('fern', { scale: 1 })
const gus = await open('gus', { scale: 1 })
await enter(chi, studio.url)
await call.chi('PUT', `/offices/${studio.token}/desks/d1`)
await enter(emil, studio.url)
await call.emil('PUT', `/offices/${studio.token}/desks/d3`)
await chi.waitForTimeout(1500)
await chi.getByRole('button', { name: '25 minutes' }).click()
await emil.getByRole('button', { name: 'Join the focus session' }).click()
await enter(bao, studio.url)
await walk(bao, [6, 5])
await enter(fern, studio.url)
await fern.getByRole('button', { name: 'Water the plant' }).click()
await enter(gus, studio.url)
await walk(gus, [20, 4])

// Alice at the door: who is inside, before she decides to enter.
// Three times the pixels, so close-ups of the map stay sharp.
const alice = await open('alice', { scale: 3 })
await alice.goto(studio.url)
await alice.locator('.landing__card').waitFor()
await alice.waitForTimeout(2500)
await cutout(alice, '.landing__card', 'door', 32)
await enter(alice)
await walk(alice, [9, 5])
await alice.waitForTimeout(6000)

// The office: Alice and Bảo high-five, Fern waters the plant.
async function moment(page) {
	await Promise.all([
		page.getByRole('button', { name: 'Wave' }).click(),
		bao.getByRole('button', { name: 'Wave' }).click(),
		fern.getByRole('button', { name: 'Water the plant' }).click(),
	])
	await page.waitForTimeout(1100)
}
await moment(alice)
await alice.screenshot({ path: png('office') })
await alice.locator('.vo-stage').screenshot({ path: png('stage') })
await around(alice, '.people__focus', 'focus', 0)

// The same moment in Nextcloud's dark theme.
const leaveRoom = (page) => page.getByRole('button', { name: 'Leave', exact: true }).first().click()
await leaveRoom(alice)
occ('user:setting', 'alice', 'theming', 'enabled-themes', '["dark"]')
await alice.reload()
await enter(alice)
await walk(alice, [9, 5])
await alice.waitForTimeout(5500)
await moment(alice)
await alice.screenshot({ path: png('office-dark') })
await leaveRoom(alice)
occ('user:setting', '--delete', 'alice', 'theming', 'enabled-themes')
await alice.reload()
await enter(alice)
await walk(alice, [9, 5])
await alice.waitForTimeout(5500)

// A coffee together: both at the machine, cups clinking.
await alice.getByRole('button', { name: 'Make coffee' }).click()
await bao.waitForTimeout(500)
await bao.getByRole('button', { name: 'Make coffee' }).click()
await alice.waitForTimeout(1300)
for (let i = 0; i < 4; i++) {
	await alice.locator('.vo-stage').screenshot({ path: png(`coffee-${i}`) })
	await alice.waitForTimeout(150)
}

// A knock: what Chi sees, and the answer Alice gets.
await alice.getByRole('button', { name: 'Actions for Chi' }).click()
await alice.getByRole('menuitem', { name: 'Knock: got 2 minutes?' }).click()
await chi.locator('.office__knock').waitFor({ timeout: 10_000 })
await chi.waitForTimeout(600)
await cutout(chi, '.office__knock', 'knock')
await chi.getByRole('button', { name: 'In 10 minutes' }).click()
await alice.locator('.office__knock').waitFor({ timeout: 10_000 })
await alice.waitForTimeout(600)
await cutout(alice, '.office__knock', 'knock-answer')
await alice.getByRole('button', { name: 'Dismiss' }).click()

// Your character.
await alice.getByRole('button', { name: 'Change character' }).first().click()
await alice.getByRole('dialog').waitFor()
await alice.waitForTimeout(800)
await alice.screenshot({ path: png('picker') })
await alice.keyboard.press('Escape')

// Dana sits in the Design corner, so the directory and Dashboard show a second busy office.
await call.dana('POST', `/offices/${design.token}/room/enter`, { session: randomBytes(16).toString('hex') })
const home = await alice.context().newPage()
await home.goto('/apps/virtualoffice/')
await home.getByText('Design corner').first().waitFor()
await home.waitForTimeout(2500)
await home.screenshot({ path: png('directory') })
await home.goto('/apps/dashboard/')
await home.locator('.panel', { hasText: 'Virtual Office' }).first().waitFor({ timeout: 20_000 })
await home.waitForTimeout(3000)
await home.screenshot({ path: png('dashboard') })
await home.close()
await leave(alice)

// Talk: the conversation's card, entered right in the chat. Tall enough that
// the whole conversation fits below Talk's floating date.
const talk = await open('alice', { height: 1080 })
await talk.goto(`/index.php/call/${chat.token}`)
await talk.locator('.vo-card').first().waitFor({ timeout: 30_000 })
// Close the participants sidebar so the office card gets the full width.
// The toggle is the last button in the conversation header.
await talk.mouse.click(1408, 68)
await talk.waitForTimeout(1500)
await talk.getByRole('button', { name: 'Enable interactive view' }).first().click()
const card = talk.locator('.vo-card__embed')
await card.getByRole('button', { name: 'Enter office' }).click()
await card.getByRole('button', { name: 'Continue here' }).click({ timeout: 2500 }).catch(() => {})
await card.locator('.vo-scene').waitFor({ timeout: 15_000 })
await talk.waitForTimeout(1200)
await walk(talk, [8, 5], card)
await talk.waitForTimeout(3000)
await card.getByRole('button', { name: 'Wave' }).click()
await talk.waitForTimeout(900)
await talk.screenshot({ path: png('talk') })
await leave(talk)

// On a phone.
const phone = await open('alice', { width: 390, height: 844, scale: 3, mobile: true })
await enter(phone, studio.url)
await phone.waitForTimeout(4000)
await phone.screenshot({ path: png('phone') })
await leave(phone)

for (const page of [bao, chi, emil, fern, gus]) {
	await leave(page)
}
await browser.close()
console.log(JSON.stringify({ office: studio.url }))
