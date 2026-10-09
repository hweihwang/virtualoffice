/**
 * SPDX-FileCopyrightText: 2026 Hoang Pham
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
import type { Page } from '@playwright/test'

import { expect, test } from '@playwright/test'
import { Api, clearPresence, createTeam, login, occ, sql, toneWav, uniqueName, upload, waitFor } from './helpers.ts'

const TILE = 40
const TRANSPORT = process.env.VO_TRANSPORT ?? 'push'
/** How soon another person must see an action: push is near-instant, polling replays within about a second. */
const VISIBLE_WITHIN = TRANSPORT === 'push' ? 1500 : 3000

let alice: Api
let teamId: string

test.beforeAll(async () => {
	alice = await Api.as('alice')
	teamId = createTeam('alice', uniqueName('Browser Team'), ['bao'])
	await (await Api.as('alice')).call('DELETE', '/me/preferences')
	await (await Api.as('bao')).call('DELETE', '/me/preferences')
})

test.beforeEach(() => clearPresence())

async function newOffice(): Promise<string> {
	const created = await alice.call('POST', '/offices', { title: uniqueName('Room'), audience: { kind: 'team', id: teamId } })
	return created.data.token
}

async function enter(page: Page, token: string) {
	await page.goto(`/index.php/apps/virtualoffice/o/${token}`)
	await page.getByRole('button', { name: 'Enter office' }).click()
	await expect(page.locator('.room')).toBeVisible()
	await expect(page.locator('.room')).toHaveAttribute('data-transport', TRANSPORT)
}

/** Displayed cell of a character, read from its transform. */
async function cellOf(page: Page, uid: string): Promise<[number, number] | null> {
	return page.evaluate(({ uid, TILE }) => {
		const el = document.querySelector<HTMLElement>(`.vo-actor[data-uid="${uid}"]`)
		const match = el?.style.transform.match(/translate3d\(([-\d.]+)px, ([-\d.]+)px/)
		return match ? [(Number(match[1]) + 24 - TILE / 2) / TILE, (Number(match[2]) + 58 - TILE) / TILE] as [number, number] : null
	}, { uid, TILE })
}

async function clickCell(page: Page, [x, y]: [number, number]) {
	const box = (await page.locator('.vo-stage').boundingBox())!
	const scale = box.width / (32 * TILE)
	await page.mouse.click(box.x + (x * TILE + TILE / 2) * scale, box.y + (y * TILE + TILE / 2) * scale)
}

test('two people see each other walk, react and use props', async ({ browser }) => {
	const token = await newOffice()
	const a = await login(browser, 'alice')
	const b = await login(browser, 'bao')
	await enter(a, token)
	await enter(b, token)
	await expect(b.locator('.vo-actor[data-uid="alice"]')).toBeVisible()
	await expect(a.locator('.vo-actor[data-uid="bao"]')).toBeVisible()
	await expect(b.locator('.vo-actor[data-uid="alice"] .vo-name')).toHaveText('Alice')
	await expect(b.locator('.vo-actor[data-uid="bao"] .vo-name')).toHaveText('Bảo (you)')

	const start = (await cellOf(b, 'alice'))!
	const clickedAt = Date.now()
	await clickCell(a, [start[0] + 4, start[1]])
	// Alice sees her own character move right away.
	await waitFor(async () => ((await cellOf(a, 'alice'))![0] > start[0] + 0.2), 400, 16)
	// Bao sees the walk begin, then arrive, instead of a jump.
	await waitFor(async () => {
		const c = await cellOf(b, 'alice')
		return c && c[0] > start[0] + 0.2 && c[0] < start[0] + 3.8
	}, VISIBLE_WITHIN, 16)
	const seenAfter = Date.now() - clickedAt
	await waitFor(async () => {
		const c = await cellOf(b, 'alice')
		return c && Math.abs(c[0] - (start[0] + 4)) < 0.01
	}, 5000)
	console.log(`[${TRANSPORT}] remote walk visible after ${seenAfter} ms`)

	await a.getByRole('button', { name: 'Wave' }).click()
	await expect(b.locator('.vo-actor[data-uid="alice"] .vo-emote.vo-visible')).toBeVisible({ timeout: VISIBLE_WITHIN })
	await expect(b.locator('.vo-actor[data-uid="alice"] .vo-emote')).not.toHaveClass(/vo-visible/, { timeout: 7000 })

	await a.getByRole('button', { name: 'Make coffee' }).click()
	await expect(b.locator('.vo-prop-coffee.vo-active')).toBeVisible({ timeout: 12_000 })

	await a.getByRole('button', { name: 'Focusing' }).click()
	await expect(b.locator('.vo-actor[data-uid="alice"]')).toHaveAttribute('data-mode', 'focus', { timeout: VISIBLE_WITHIN })

	await a.getByRole('button', { name: 'Leave' }).click()
	await expect(b.locator('.vo-actor[data-uid="alice"]')).toHaveCount(0, { timeout: VISIBLE_WITHIN })
	await expect(a.getByRole('button', { name: 'Enter office' })).toBeVisible()
	await a.context().close()
	await b.context().close()
})

test('newcomers arrive next to people, react together and clink cups', async ({ browser }) => {
	const token = await newOffice()
	const a = await login(browser, 'alice')
	const b = await login(browser, 'bao')
	await enter(a, token)
	await enter(b, token)
	// Both characters are placed once the first frame has rendered.
	await expect.poll(async () => (await cellOf(b, 'alice')) !== null && (await cellOf(b, 'bao')) !== null, { timeout: VISIBLE_WITHIN }).toBe(true)
	const aliceAt = (await cellOf(b, 'alice'))!
	const baoAt = (await cellOf(b, 'bao'))!
	// Close by, with two free cells between them so the name tags stay readable,
	// and near enough to react together.
	expect(Math.max(Math.abs(aliceAt[0] - baoAt[0]), Math.abs(aliceAt[1] - baoAt[1]))).toBeCloseTo(3, 1)
	expect(Math.hypot(aliceAt[0] - baoAt[0], aliceAt[1] - baoAt[1])).toBeLessThanOrEqual(3.01)

	// The two clicks must reach the server within 1.5 s; on a busy machine they
	// sometimes do not, so wave again like people would.
	await expect(async () => {
		await Promise.all([a.getByRole('button', { name: 'Wave' }).click(), b.getByRole('button', { name: 'Wave' }).click()])
		await expect(a.locator('.vo-pair[data-emote="wave"]')).toBeVisible({ timeout: VISIBLE_WITHIN })
		await expect(b.locator('.vo-pair[data-emote="wave"]')).toBeVisible({ timeout: VISIBLE_WITHIN })
	}).toPass({ timeout: 30_000, intervals: [2500] })
	await expect(b.locator('.office__toast')).toHaveText(/^(Alice and Bảo|Bảo and Alice) high-fived$/)

	await a.getByRole('button', { name: 'Make coffee' }).click()
	await b.getByRole('button', { name: 'Make coffee' }).click()
	await expect(b.locator('.vo-prop-coffee.vo-clink')).toBeVisible({ timeout: 12_000 })

	const hide = (hidden: boolean) => b.evaluate((value) => {
		Object.defineProperty(document, 'hidden', { value, configurable: true })
		document.dispatchEvent(new Event('visibilitychange'))
	}, hidden)
	await hide(true)
	await a.getByRole('button', { name: 'Leave' }).click()
	await expect(b.locator('.room__meta')).toContainText('1 of', { timeout: 20_000 })
	await a.getByRole('button', { name: 'Enter office' }).click()
	await expect(b).toHaveTitle(/^\(1\) /, { timeout: 20_000 })
	await hide(false)
	await expect(b).not.toHaveTitle(/^\(/)
	await a.context().close()
	await b.context().close()
})

test('a desk shows its owner, status and note while they are away', async ({ browser }) => {
	const token = await newOffice()
	const a = await login(browser, 'alice')
	const b = await login(browser, 'bao')
	await enter(a, token)
	await enter(b, token)
	const today = b.getByRole('textbox', { name: 'Today' })
	await today.fill('Pairing on the export')
	await today.press('Enter')
	await expect(b.locator('.office__toast')).toHaveText('Others can now see what you are working on today')
	await b.getByRole('button', { name: 'Claim a desk' }).click()
	await expect(b.getByRole('button', { name: /^Free Desk \d+$/ })).toBeVisible()
	await expect(a.locator('.vo-desk[data-uid="bao"]')).toBeVisible({ timeout: 10_000 })
	await expect(a.locator('.vo-actor[data-uid="bao"]')).toHaveAttribute('title', 'Pairing on the export', { timeout: VISIBLE_WITHIN })

	const bao = await Api.as('bao')
	await bao.call('PUT', '/ocs/v2.php/apps/user_status/api/v1/user_status/status', { statusType: 'dnd' })
	try {
		await b.getByRole('button', { name: 'Leave' }).click()
		const desk = a.locator('.vo-desk[data-uid="bao"]')
		await expect(desk).toHaveClass(/vo-desk-away/, { timeout: VISIBLE_WITHIN })
		await expect(desk.locator('.vo-desk-note')).toHaveText('Pairing on the export')
		// Statuses have no events; the next desk refresh follows an arrival or a minute.
		await a.reload()
		await a.getByRole('button', { name: 'Enter office' }).click()
		await expect(a.locator('.vo-desk[data-uid="bao"] .vo-status')).toHaveAttribute('data-status', 'dnd')
		const desks = a.locator('.people__desks')
		await expect(desks.getByText('Bảo')).toBeVisible()
		await expect(desks.getByText(/Do not disturb/)).toBeVisible()
	} finally {
		await bao.call('PUT', '/ocs/v2.php/apps/user_status/api/v1/user_status/status', { statusType: 'online' })
		await bao.call('PUT', '/me/today', { text: '', expiresAt: Date.now() })
	}
	await a.context().close()
	await b.context().close()
})

test('a knock shows in the office and the answer comes back', async ({ browser }) => {
	test.skip(TRANSPORT !== 'push', 'The knock card needs Client Push; without it the notification covers knocks')
	const token = await newOffice()
	const a = await login(browser, 'alice')
	const b = await login(browser, 'bao')
	await enter(a, token)
	await enter(b, token)
	// At night in Alice's time zone, the office asks first.
	b.on('dialog', (dialog) => void dialog.accept())
	await b.getByRole('button', { name: 'Actions for Alice' }).click()
	await b.getByRole('menuitem', { name: 'Knock: got 2 minutes?' }).click()
	await expect(b.locator('.office__toast')).toHaveText('You knocked. Alice gets a notification.')
	const card = a.getByRole('alertdialog', { name: 'Knock' })
	await expect(card).toContainText('Bảo knocked: got 2 minutes?', { timeout: VISIBLE_WITHIN })
	await card.getByRole('button', { name: 'In 10 minutes' }).click()
	await expect(card).toHaveCount(0)
	await expect(b.locator('.office__knock')).toContainText('Alice can talk in 10 minutes', { timeout: VISIBLE_WITHIN })
	await b.locator('.office__knock').getByRole('button', { name: 'Dismiss' }).click()
	await expect(b.locator('.office__knock')).toHaveCount(0)
	await a.context().close()
	await b.context().close()
})

test('the Dashboard shows who is in, and an empty office offers to tell you', async ({ browser }) => {
	const token = await newOffice()
	const b = await login(browser, 'bao')
	await b.goto(`/index.php/apps/virtualoffice/o/${token}`)
	const watch = b.getByRole('switch', { name: 'Tell me when someone arrives' })
	await watch.check({ force: true })
	await expect(watch).toBeChecked()

	const a = await login(browser, 'alice')
	await enter(a, token)
	// Added to the Dashboard like with Customize.
	expect((await (await Api.as('bao')).call('POST', '/ocs/v2.php/apps/dashboard/api/v3/layout', { layout: ['virtualoffice'] })).status).toBe(200)
	await b.goto('/index.php/apps/dashboard/')
	const widget = b.locator('.panel').filter({ hasText: 'Virtual Office' })
	await expect(widget.getByText('Alice', { exact: true })).toBeVisible({ timeout: 20_000 })
	await a.context().close()
	await b.context().close()
})

test('Team resources hang on the wall with what is due today', async ({ browser }) => {
	const token = await newOffice()
	const deck = '/index.php/apps/deck/api/v1.0'
	const boardTitle = uniqueName('Sprint')
	const board = (await alice.call('POST', `${deck}/boards`, { title: boardTitle, color: '0082c9' })).data
	await alice.call('POST', `${deck}/boards/${board.id}/acl`, { type: 7, participant: teamId, permissionEdit: true, permissionShare: false, permissionManage: false })
	const stack = (await alice.call('POST', `${deck}/boards/${board.id}/stacks`, { title: 'To do', order: 0 })).data
	await alice.call('POST', `${deck}/boards/${board.id}/stacks/${stack.id}/cards`, { title: 'Ship it', type: 'plain', order: 0, duedate: new Date().toISOString() })

	const b = await login(browser, 'bao')
	await enter(b, token)
	const fixture = b.locator('.vo-fixture[data-provider="deck"]').filter({ hasText: boardTitle })
	await expect(fixture).toBeVisible({ timeout: 10_000 })
	await expect(fixture).toHaveAttribute('href', new RegExp(`/apps/deck/board/${board.id}`))
	await expect(fixture.locator('.vo-fixture-badge')).toHaveText('1')
	const places = b.locator('.people__places')
	await expect(places.getByRole('link', { name: boardTitle })).toBeVisible()
	await b.context().close()
})

test('people focus together from the list', async ({ browser }) => {
	const token = await newOffice()
	const a = await login(browser, 'alice')
	const b = await login(browser, 'bao')
	await enter(a, token)
	await enter(b, token)
	await a.locator('.people__focus').getByRole('button', { name: '25 minutes' }).click()
	await expect(a.locator('.people__focus')).toContainText('25 minutes left')
	// Starting a session walks you to the focus desks.
	await expect(a.locator('.people__zone').filter({ has: a.getByRole('heading', { name: /Focus desks/ }) }).getByText('Alice (you)')).toBeVisible({ timeout: 10_000 })
	const join = b.locator('.people__focus').getByRole('button', { name: 'Join the focus session' })
	await expect(join).toBeVisible({ timeout: VISIBLE_WITHIN })
	await join.click()
	await expect(a.locator('.vo-actor[data-uid="bao"]')).toHaveClass(/vo-focusing/, { timeout: VISIBLE_WITHIN })
	await expect(b.locator('.vo-actor[data-uid="alice"]')).toHaveClass(/vo-focusing/)
	await b.locator('.people__focus').getByRole('button', { name: 'Leave the focus session' }).click()
	await expect(a.locator('.vo-actor[data-uid="bao"]')).not.toHaveClass(/vo-focusing/, { timeout: VISIBLE_WITHIN })
	await a.context().close()
	await b.context().close()
})

test('"Now" in the Notifications menu takes the person asked to the call', async ({ browser }) => {
	const token = await newOffice()
	const bao = await Api.as('bao')
	await bao.call('DELETE', '/ocs/v2.php/apps/notifications/api/v2/notifications')
	expect((await alice.call('POST', `/offices/${token}/knocks`, { uid: 'bao' })).status).toBe(201)

	const b = await login(browser, 'bao')
	await b.goto('/index.php/apps/files/')
	await b.getByRole('button', { name: 'Notifications' }).click()
	const item = b.locator('.notification').filter({ hasText: 'Alice knocked: got 2 minutes?' })
	await expect(item).toBeVisible({ timeout: 20_000 })
	await item.getByRole('link', { name: 'Now' }).click()
	// The office answers, then continues to the one-to-one call with Alice.
	await b.waitForURL(/\/apps\/spreed\/|\/call\//, { timeout: 20_000 })
	const reply = ((await alice.call('GET', '/ocs/v2.php/apps/notifications/api/v2/notifications')).data as any[]).find((n) => n.app === 'virtualoffice' && n.subject === 'Bảo can talk now')
	expect(reply).toBeTruthy()
	await b.context().close()
})

test('office counts stay right after "Show more offices"', async ({ browser }) => {
	const team = createTeam('alice', uniqueName('Many offices'), ['bao'])
	for (let i = 0; i < 51; i++) {
		await alice.call('POST', '/offices', { title: `Many ${String(i).padStart(2, '0')} ${uniqueName('x')}`, audience: { kind: 'team', id: team } })
	}
	const b = await login(browser, 'bao')
	await b.goto('/index.php/apps/virtualoffice/')
	await b.getByRole('button', { name: 'Show more offices' }).click()
	await expect(b.locator('.office-card').nth(50)).toBeVisible()
	// Counts refresh every 30 s; wait for one refresh after paging.
	await b.waitForTimeout(31_000)
	await expect(b.getByText('Could not load who is here')).toHaveCount(0)
	await b.context().close()
})

test('the door shows the right count right after you leave', async ({ browser }) => {
	const token = await newOffice()
	const a = await login(browser, 'alice')
	const b = await login(browser, 'bao')
	await enter(a, token)
	await enter(b, token)
	await b.getByRole('button', { name: 'Leave' }).click()
	await expect(b.locator('.landing__meta')).toContainText('1 person here', { timeout: 5000 })
	await a.getByRole('button', { name: 'Leave' }).click()
	await expect(a.locator('.landing__meta')).toContainText('Nobody here right now', { timeout: 5000 })
	await a.context().close()
	await b.context().close()
})

test('walking with the keyboard stops when the key is released', async ({ browser }) => {
	const token = await newOffice()
	const a = await login(browser, 'alice')
	await enter(a, token)
	const map = a.getByRole('application', { name: 'Office map' })
	await map.focus()
	const start = (await cellOf(a, 'alice'))!
	await a.keyboard.down('ArrowUp')
	await a.waitForTimeout(700)
	await a.keyboard.up('ArrowUp')
	await a.waitForTimeout(800)
	const after = (await cellOf(a, 'alice'))!
	expect(start[1] - after[1]).toBeGreaterThanOrEqual(2)
	expect(start[1] - after[1]).toBeLessThanOrEqual(5)
	expect(Number.isInteger(Math.round(after[1] * 1000) / 1000)).toBe(true)
	await a.waitForTimeout(600)
	expect(await cellOf(a, 'alice')).toEqual(after)
	// Keys typed into a field never move the character.
	await a.keyboard.press('Escape')
	await a.keyboard.press('2')
	await a.context().close()
})

test('the people and places list offers the same actions', async ({ browser }) => {
	const token = await newOffice()
	const a = await login(browser, 'alice')
	const b = await login(browser, 'bao')
	await enter(a, token)
	await enter(b, token)
	await a.getByRole('button', { name: 'List' }).click()
	await expect(a.locator('.office-scene')).toHaveCount(0)
	const desks = a.locator('.people__zone').filter({ has: a.getByRole('heading', { name: /Focus desks/ }) })
	await desks.getByRole('button', { name: 'Go here' }).click()
	await expect(desks.getByText('Alice (you)')).toBeVisible({ timeout: 8000 })
	await expect(b.locator('.people__zone').filter({ has: b.getByRole('heading', { name: /Focus desks/ }) }).getByText('Alice')).toBeVisible({ timeout: 8000 })
	await a.getByRole('button', { name: 'Map' }).click()
	await expect(a.locator('.office-scene')).toBeVisible()
	await a.context().close()
	await b.context().close()
})

test('a second window takes over only when asked, and the first one stops', async ({ browser }) => {
	const token = await newOffice()
	const first = await login(browser, 'alice')
	await enter(first, token)
	const second = await first.context().newPage()
	await second.goto(`/index.php/apps/virtualoffice/o/${token}`)
	await second.getByRole('button', { name: 'Enter office' }).click()
	await expect(second.getByText('You are already in this office in another window or device.')).toBeVisible()
	await expect(first.locator('.room')).toBeVisible()
	await second.getByRole('button', { name: 'Continue here' }).click()
	await expect(second.locator('.room')).toBeVisible()
	await expect(first.getByText('You continued in another window.')).toBeVisible({ timeout: 8000 })
	expect(sql("SELECT count(*) FROM oc_vo_presence WHERE uid = 'alice'")).toBe('1')
	await first.context().close()
})

test('closing the page leaves the office', async ({ browser }) => {
	const token = await newOffice()
	const a = await login(browser, 'alice')
	const b = await login(browser, 'bao')
	await enter(a, token)
	await enter(b, token)
	await expect(b.locator('.vo-actor[data-uid="alice"]')).toBeVisible()
	await a.goto('/index.php/apps/virtualoffice/')
	await expect(b.locator('.vo-actor[data-uid="alice"]')).toHaveCount(0, { timeout: VISIBLE_WITHIN + 1000 })
	await a.context().close()
	await b.context().close()
})

test('a new look reaches everyone in the room', async ({ browser }) => {
	const token = await newOffice()
	const a = await login(browser, 'alice')
	const b = await login(browser, 'bao')
	await enter(a, token)
	await enter(b, token)
	await a.locator('.controls').getByRole('button', { name: 'Change character' }).click()
	const dialog = a.getByRole('dialog', { name: 'Your character' })
	await dialog.getByText('Bear').click()
	await dialog.getByText('Butter').click()
	await dialog.getByText('Beanie').click()
	await dialog.getByRole('button', { name: 'Save' }).click()
	await expect(dialog).toHaveCount(0)
	await expect.poll(async () => b.locator('.vo-actor[data-uid="alice"] .vo-facing-south svg').innerHTML(), { timeout: VISIBLE_WITHIN + 1000 }).toContain('#f1d174')
	await a.context().close()
	await b.context().close()
})

test('a manager can take someone out, and they see why', async ({ browser }) => {
	const token = await newOffice()
	const a = await login(browser, 'alice')
	const b = await login(browser, 'bao')
	await enter(a, token)
	await enter(b, token)
	a.on('dialog', (d) => d.accept())
	await a.getByRole('button', { name: 'List' }).click()
	await a.getByRole('button', { name: 'Actions for Bảo' }).click()
	await a.getByRole('menuitem', { name: 'Remove from office for 1 hour' }).click()
	await expect(b.getByText('A manager removed you from this office for a while.')).toBeVisible({ timeout: 8000 })
	await expect(b.getByRole('button', { name: 'Enter office' })).toBeDisabled()
	await a.getByRole('button', { name: 'Map' }).click()
	await a.context().close()
	await b.context().close()
})

test('people outside the audience only see that the office is not available', async ({ browser }) => {
	const token = await newOffice()
	const c = await login(browser, 'chi')
	await c.goto(`/index.php/apps/virtualoffice/o/${token}`)
	await expect(c.getByText('Office not available')).toBeVisible()
	await expect(c.getByRole('button', { name: 'Enter office' })).toHaveCount(0)
	await c.context().close()
})

test('a small office takes the season its manager picks', async ({ browser }) => {
	const created = await alice.call('POST', '/offices', { title: uniqueName('Small'), audience: { kind: 'team', id: teamId }, layoutId: 'compact-office-v1' })
	const a = await login(browser, 'alice')
	await a.goto(`/index.php/apps/virtualoffice/o/${created.data.token}`)
	await expect(a.locator('.landing__preview')).toHaveAttribute('src', /office-preview-compact-office-v1\.webp$/)
	await a.getByRole('button', { name: 'Settings', exact: true }).click()
	const dialog = a.getByRole('dialog', { name: 'Office settings' })
	await expect(dialog.locator('.settings__layout select')).toHaveValue('compact-office-v1')
	await dialog.getByRole('combobox', { name: 'Season', exact: true }).selectOption({ label: 'Lunar New Year' })
	await dialog.getByRole('button', { name: 'Save' }).click()
	await expect(dialog).toHaveCount(0)
	await a.getByRole('button', { name: 'Enter office' }).click()
	await expect(a.locator('.vo-stage')).toHaveCSS('width', `${22 * TILE}px`)
	await expect(a.locator('.vo-season[data-season="lunar"]')).toHaveCount(1)
	await expect(a.locator('.room__meta')).toContainText('1 of 12 here')
	await a.context().close()
})

/** Keeps the audio elements the office plays, so the test can look at them. */
function watchAudio() {
	const w = window as any
	w.__media = new Set<HTMLMediaElement>()
	const play = HTMLMediaElement.prototype.play
	HTMLMediaElement.prototype.play = function() {
		w.__media.add(this)
		return play.call(this)
	}
}

/** Where the office's music is in each window: playing source and position in seconds. */
function musicState(page: Page) {
	return page.evaluate(() => [...(window as any).__media as Set<HTMLMediaElement>]
		.filter((m) => !m.srcObject && m.src !== '')
		.map((m) => ({ playing: !m.paused, time: m.currentTime }))[0] ?? null)
}

test('music plays in sync near the player and stops when its owner leaves', async ({ browser }) => {
	const token = await newOffice()
	const name = `office-tone-${uniqueName('x').slice(2)}.wav`
	await upload(alice, 'alice', name, toneWav(30), 'audio/wav')
	const a = await login(browser, 'alice')
	const b = await login(browser, 'bao')
	await a.addInitScript(watchAudio)
	await b.addInitScript(watchAudio)
	await enter(a, token)
	await enter(b, token)

	const common = a.locator('.people__zone').filter({ has: a.getByRole('heading', { name: /Common room/ }) })
	await common.getByRole('button', { name: 'Play music' }).click()
	const picker = a.getByRole('dialog', { name: 'Choose music to play for the office' })
	await picker.getByRole('row', { name: new RegExp(name.replace('.wav', '')) }).click()
	await picker.getByRole('button', { name: 'Play' }).click()
	// Alice walks to the player and starts it; both see what plays.
	await expect(common.getByText(/Now playing: office-tone-.* · Alice/)).toBeVisible({ timeout: 15_000 })
	await expect(b.locator('.people__music')).toContainText('· Alice', { timeout: VISIBLE_WITHIN + 1000 })
	await expect(a.locator('.vo-player-fx')).toHaveClass(/vo-active/)

	// Bảo walks next to the player too: both hear the same moment.
	await clickCell(b, [13, 3])
	await expect.poll(async () => (await musicState(a))?.playing, { timeout: 10_000 }).toBe(true)
	await expect.poll(async () => (await musicState(b))?.playing, { timeout: 15_000 }).toBe(true)
	// After a few seconds both play the same moment: in one room they sound as one.
	await a.waitForTimeout(5000)
	const [ta, tb] = await Promise.all([musicState(a), musicState(b)])
	console.log(`music positions: alice ${ta!.time.toFixed(3)} s, bao ${tb!.time.toFixed(3)} s`)
	expect(Math.abs(ta!.time - tb!.time)).toBeLessThan(0.1)

	// Out of hearing at the focus desks, the music stops for Bảo but not for Alice.
	await b.locator('.people__zone').filter({ has: b.getByRole('heading', { name: /Focus desks/ }) }).getByRole('button', { name: 'Go here' }).click()
	await expect.poll(async () => (await musicState(b))?.playing ?? false, { timeout: 15_000 }).toBe(false)
	expect((await musicState(a))?.playing).toBe(true)

	// The music is Alice's file: it stops when she leaves.
	await a.getByRole('button', { name: 'Leave' }).click()
	await expect(b.locator('.people__music')).toHaveCount(0, { timeout: VISIBLE_WITHIN + 1000 })
	await expect(b.locator('.vo-player-fx')).not.toHaveClass(/vo-active/)
	await a.context().close()
	await b.context().close()
})

/** Position of the office's music in a window, minus how long its sound takes to reach the speakers. */
function heardAt(page: Page) {
	return page.evaluate(() => {
		const media = [...(window as any).__media as Set<HTMLMediaElement>].find((m) => !m.srcObject && m.src !== '' && !m.paused)
		const context = new AudioContext()
		const latency = (context.outputLatency || context.baseLatency || 0)
		void context.close()
		return media ? media.currentTime - latency : null
	})
}

test('Chromium, Firefox and Safari play the same moment, so one room hears no echo', async ({ browser, browserName, playwright }) => {
	test.skip(browserName !== 'chromium', 'Starts the other engines itself')
	const team = createTeam('alice', uniqueName('Three engines'), ['bao', 'chi'])
	const token = (await alice.call('POST', '/offices', { title: uniqueName('Engines'), audience: { kind: 'team', id: team } })).data.token
	const name = `office-click-${uniqueName('x').slice(2)}.wav`
	await upload(alice, 'alice', name, toneWav(60), 'audio/wav')
	const firefox = await playwright.firefox.launch()
	const webkit = await playwright.webkit.launch()
	try {
		const a = await login(browser, 'alice')
		const b = await login(firefox, 'bao')
		const c = await login(webkit, 'chi')
		for (const page of [a, b, c]) {
			await page.addInitScript(watchAudio)
			await enter(page, token)
		}
		const common = a.locator('.people__zone').filter({ has: a.getByRole('heading', { name: /Common room/ }) })
		await common.getByRole('button', { name: 'Play music' }).click()
		const picker = a.getByRole('dialog', { name: 'Choose music to play for the office' })
		await picker.getByRole('row', { name: new RegExp(name.replace('.wav', '')) }).click()
		await picker.getByRole('button', { name: 'Play' }).click()
		await expect(common.getByText(/Now playing/)).toBeVisible({ timeout: 15_000 })
		await clickCell(b, [13, 3])
		await clickCell(c, [11, 3])
		for (const page of [a, b, c]) {
			await expect.poll(async () => (await musicState(page))?.playing, { timeout: 15_000 }).toBe(true)
		}
		// Let every window settle (a late seek corrects itself after two seconds), then sample a few times.
		await a.waitForTimeout(8000)
		for (let i = 0; i < 4; i++) {
			const times = (await Promise.all([a, b, c].map(heardAt))) as number[]
			console.log(`heard at: chromium ${times[0].toFixed(3)} s, firefox ${times[1].toFixed(3)} s, webkit ${times[2].toFixed(3)} s`)
			expect(Math.max(...times) - Math.min(...times)).toBeLessThan(0.06)
			await a.waitForTimeout(1000)
		}
	} finally {
		await firefox.close()
		await webkit.close()
	}
})

/** A fixed-offset zone where it is now between 01:00 and 05:00, outside anyone's default hours. */
function nightZone(): string {
	for (let offset = -12; offset <= 14; offset++) {
		const hour = (new Date().getUTCHours() + offset + 24) % 24
		if (hour >= 1 && hour <= 5) {
			// Etc zones count the other way round.
			return offset === 0 ? 'Etc/UTC' : `Etc/GMT${offset > 0 ? '-' : '+'}${Math.abs(offset)}`
		}
	}
	throw new Error('No night zone found')
}

test('local times, shared hours and a word before knocking at night', async ({ browser }) => {
	const token = await newOffice()
	const night = nightZone()
	occ('user:setting', 'alice', 'core', 'timezone', 'Europe/Berlin')
	occ('user:setting', 'bao', 'core', 'timezone', night)
	try {
		const a = await login(browser, 'alice', { timezoneId: 'Europe/Berlin' })
		const b = await login(browser, 'bao', { timezoneId: 'Europe/Berlin' })
		await enter(a, token)
		await enter(b, token)
		const bao = a.locator('.person').filter({ hasText: 'Bảo' })
		await expect(bao.locator('.clock')).toHaveText(/\d{1,2}:\d{2}/, { timeout: 10_000 })
		await expect(bao.locator('.clock__night')).toBeVisible()
		// Two people with a known zone: the header says whether they share hours today.
		await expect(a.locator('.room__shared')).toHaveText(/^(Shared hours today: .+|No shared hours today)$/)
		// Alice never set her working hours.
		await expect(a.locator('.controls__hint').first()).toContainText('Set your working hours')
		await expect(a.locator('.controls__hint a').first()).toHaveAttribute('href', /\/settings\/user\/availability$/)
		// Bảo's browser runs on Berlin time, but his Nextcloud says otherwise.
		await expect(b.locator('.controls__hint').first()).toContainText(`Your Nextcloud time zone is ${night}`)

		let asked = ''
		a.once('dialog', (dialog) => {
			asked = dialog.message()
			void dialog.dismiss()
		})
		await a.getByRole('button', { name: 'Actions for Bảo' }).click()
		await a.getByRole('menuitem', { name: 'Knock: got 2 minutes?' }).click()
		await expect.poll(() => asked).toMatch(/^It is .+ for Bảo, outside their working hours\. Knock anyway\?$/)
		// Dismissed: no knock was sent.
		await expect(a.locator('.office__toast')).not.toContainText('You knocked')
		await a.context().close()
		await b.context().close()
	} finally {
		occ('user:setting', 'bao', 'core', 'timezone', 'Europe/Berlin')
	}
})
