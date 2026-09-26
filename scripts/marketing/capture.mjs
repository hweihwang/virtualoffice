/**
 * SPDX-FileCopyrightText: 2026 Hoang Pham
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Stages a small office on a fresh push fixture and records the screenshots
 * and video clips for the README, the App Store and the landing page into
 * build/marketing/. Run it through scripts/marketing/build.sh.
 */
import { chromium, request } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { copyFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
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
mkdirSync(resolve(out, 'video'), { recursive: true })

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

// People
for (const [uid, name] of [['dana', 'Dana'], ['emil', 'Emil']]) {
	try {
		occ('user:info', uid)
	} catch {
		occ('user:add', '--password-from-env', '--display-name', name, uid)
	}
}
occ('config:app:set', 'dashboard', 'layout', '--value=virtualoffice,spreed,recommendations')
occ('group:add', '--display-name', 'Design', 'design')
for (const uid of ['alice', 'bao', 'dana']) {
	occ('group:adduser', 'design', uid)
}
const people = {
	alice: { creature: 'rabbit', palette: 'rose', accessory: 'scarf' },
	bao: { creature: 'cat', palette: 'sky', accessory: 'flower' },
	chi: { creature: 'bear', palette: 'cocoa', accessory: 'glasses' },
	dana: { creature: 'bird', palette: 'butter', accessory: 'beanie' },
	emil: { creature: 'cat', palette: 'sage', accessory: 'none' },
}
const call = {}
for (const [uid, appearance] of Object.entries(people)) {
	call[uid] = await as(uid)
	await call[uid]('PUT', '/me/preferences', { revision: 0, preferences: { appearance, ui: { view: 'scene', reducedEffects: false, announcements: true } } })
	await call[uid]('PUT', '/ocs/v2.php/apps/user_status/api/v1/user_status/status', { statusType: 'online' })
}
const admin = await as('vo_admin')
const endOfDay = Date.now() + 8 * 3600_000

// Offices
const team = JSON.parse(occ('circles:manage:create', '--type', 'user', '--output=json', 'alice', 'Studio team'))
for (const uid of ['bao', 'chi', 'dana', 'emil']) {
	occ('circles:members:add', '--type', 'user', team.id, uid)
}
const studio = await call.alice('POST', '/offices', { title: 'The Studio', audience: { kind: 'team', id: team.id } })
const chat = await call.alice('POST', '/ocs/v2.php/apps/spreed/api/v4/room', { roomType: 2, roomName: 'Studio chat' })
for (const uid of ['bao', 'chi', 'dana', 'emil']) {
	await call.alice('POST', `/ocs/v2.php/apps/spreed/api/v4/room/${chat.token}/participants`, { newParticipant: uid, source: 'users' })
}
const linked = await call.alice('PATCH', `/offices/${studio.token}`, { talk: { source: 'link', url: `${web}/call/${chat.token}`, label: 'Studio chat' } }, { 'If-Match': String(studio.revision) })
const design = await admin('POST', '/offices', { title: 'Design corner', audience: { kind: 'group', id: 'design' }, managerUid: 'dana' })
const launch = await call.bao('POST', '/ocs/v2.php/apps/spreed/api/v4/room', { roomType: 2, roomName: 'Launch planning' })
for (const uid of ['alice', 'chi']) {
	await call.bao('POST', `/ocs/v2.php/apps/spreed/api/v4/room/${launch.token}/participants`, { newParticipant: uid, source: 'users' })
}
await call.bao('POST', `/conversations/${launch.token}/office`)

// Dana is out: her desk shows her status and note. Chi's note shows while inside.
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

const browser = await chromium.launch({ headless: true, args: ['--host-resolver-rules=MAP cloud.example.com:443 127.0.0.1:18443'] })
async function open(user, { width = 1440, height = 900, scale = 2, video = false } = {}) {
	const startedAt = Date.now()
	const context = await browser.newContext({
		baseURL: web,
		ignoreHTTPSErrors: true,
		viewport: { width, height },
		deviceScaleFactor: scale,
		// Talk warns about headless browsers it does not recognise.
		userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36',
		...(video ? { recordVideo: { dir: resolve(out, 'video'), size: { width, height } } } : {}),
	})
	const page = await context.newPage()
	await page.goto('/login')
	await page.locator('#user').fill(user)
	await page.locator('#password').fill(pass)
	await page.locator('button[type=submit]').click()
	await page.waitForURL(/\/apps\//)
	// Seconds into this page's recording.
	page.at = () => (Date.now() - startedAt) / 1000
	return page
}
async function enter(page, url) {
	await page.goto(url)
	await page.getByRole('button', { name: 'Enter office' }).click()
	await page.getByRole('button', { name: 'Continue here' }).click({ timeout: 2500 }).catch(() => {})
	await page.locator('.vo-actor.is-you, .vo-actor[data-you="true"]').first().waitFor({ timeout: 10_000 }).catch(() => {})
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

// Still pictures
const bao = await open('bao', { scale: 1 })
const chi = await open('chi', { scale: 1 })
const emil = await open('emil', { scale: 1 })
const alice = await open('alice')
// Chi and Emil have desks, so the focus session walks them there.
await enter(chi, studio.url)
await call.chi('PUT', `/offices/${studio.token}/desks/d1`)
await enter(emil, studio.url)
await call.emil('PUT', `/offices/${studio.token}/desks/d3`)
await chi.waitForTimeout(1500)
await chi.getByRole('button', { name: '25 minutes' }).click()
await emil.getByRole('button', { name: 'Join the focus session' }).click()
await enter(bao, studio.url)
await walk(bao, [6, 5])
await enter(alice, studio.url)
await walk(alice, [9, 5])
await alice.waitForTimeout(6000)
await alice.screenshot({ path: resolve(out, 'office.png') })
await alice.locator('.vo-stage').screenshot({ path: resolve(out, 'stage.png') })

// Dana sits in the Design corner, so the directory and Dashboard show a second busy office.
await call.dana('POST', `/offices/${design.token}/room/enter`, { session: randomBytes(16).toString('hex') })
const home = await alice.context().newPage()
await home.goto('/apps/virtualoffice/')
await home.getByText('Design corner').first().waitFor()
await home.waitForTimeout(2500)
await home.screenshot({ path: resolve(out, 'directory.png') })
await home.goto('/apps/dashboard/')
await home.locator('.panel', { hasText: 'Virtual Office' }).first().waitFor({ timeout: 20_000 })
await home.waitForTimeout(3000)
await home.screenshot({ path: resolve(out, 'dashboard.png') })
await home.close()
await leave(alice)

// Talk: the conversation's card, entered right in the chat. Tall enough that
// the whole conversation fits below Talk's floating date.
const talk = await open('alice', { height: 1080, video: true })
const talkMarks = {}
await talk.goto(`/index.php/call/${chat.token}`)
await talk.locator('.vo-card').first().waitFor({ timeout: 30_000 })
// Close the participants sidebar so the office card gets the full width.
// The toggle is the last button in the conversation header.
await talk.mouse.click(1408, 68)
await talk.waitForTimeout(1500)
talkMarks.card = talk.at()
await talk.getByRole('button', { name: 'Enable interactive view' }).first().click()
const card = talk.locator('.vo-card__embed')
await card.getByRole('button', { name: 'Enter office' }).click()
await card.getByRole('button', { name: 'Continue here' }).click({ timeout: 2500 }).catch(() => {})
await card.locator('.vo-scene').waitFor({ timeout: 15_000 })
await talk.waitForTimeout(1200)
await walk(talk, [8, 5], card)
await talk.waitForTimeout(3000)
await talk.screenshot({ path: resolve(out, 'talk.png') })
await card.getByRole('button', { name: 'Wave' }).click()
await talk.waitForTimeout(2500)
talkMarks.end = talk.at()
const talkVideo = talk.video()
await leave(talk)
copyFileSync(await talkVideo.path(), resolve(out, 'talk.webm'))

// The full office in motion: say hi, coffee, a knock and a focus session.
const film = await open('alice', { scale: 1, video: true })
await enter(film, studio.url)
await film.waitForTimeout(1200)
const marks = { entered: film.at() }
await walk(film, [8, 5])
await film.waitForTimeout(3200)
marks.hi = film.at()
await Promise.all([film.getByRole('button', { name: 'Wave' }).click(), bao.getByRole('button', { name: 'Wave' }).click()])
await film.waitForTimeout(2800)
marks.coffee = film.at()
await film.getByRole('button', { name: 'Make coffee' }).click()
// A moment later, as people do, so Bảo sees where Alice is going.
await bao.waitForTimeout(700)
await bao.getByRole('button', { name: 'Make coffee' }).click()
await film.waitForTimeout(3800)
marks.knock = film.at()
await film.getByRole('button', { name: 'Actions for Chi' }).click()
await film.getByRole('menuitem', { name: 'Knock: got 2 minutes?' }).click()
await chi.getByRole('button', { name: 'In 10 minutes' }).click({ timeout: 10_000 })
await film.waitForTimeout(3200)
marks.focus = film.at()
await film.getByRole('button', { name: 'Join the focus session' }).click()
// The button sits low in the list; keep the whole office in view.
await film.evaluate(() => {
	for (const el of [document.scrollingElement, ...document.querySelectorAll('*')]) {
		if (el && el.scrollTop > 0) {
			el.scrollTop = 0
		}
	}
})
await film.waitForTimeout(4500)
marks.end = film.at()
const filmVideo = film.video()
await leave(film)
copyFileSync(await filmVideo.path(), resolve(out, 'office.webm'))

for (const page of [bao, chi, emil]) {
	await leave(page)
}
await browser.close()
writeFileSync(resolve(out, 'marks.json'), JSON.stringify({ talk: talkMarks, office: marks }, null, '\t'))
console.log(JSON.stringify({ office: studio.url, linked: linked.title, talk: talkMarks, marks }))
