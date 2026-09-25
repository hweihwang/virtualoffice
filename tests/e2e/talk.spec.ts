/**
 * SPDX-FileCopyrightText: 2026 Hoang Pham
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
import { expect, test } from '@playwright/test'
import { Api, clearPresence, createTeam, login, TALK_CONTEXT, uniqueName } from './helpers.ts'

test.use({ launchOptions: { args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] } })

test.beforeEach(() => clearPresence())

test('an office link in Talk shows a card only members can read', async ({ browser }) => {
	const alice = await Api.as('alice')
	const team = createTeam('alice', uniqueName('Talk Team'), ['bao'])
	const title = uniqueName('Studio behind the door')
	const office = (await alice.call('POST', '/offices', { title, audience: { kind: 'team', id: team } })).data

	const room = await alice.call('POST', '/ocs/v2.php/apps/spreed/api/v4/room', { roomType: 2, roomName: uniqueName('Chat') })
	const talkToken = room.data.token
	for (const uid of ['bao', 'chi']) {
		expect((await alice.call('POST', `/ocs/v2.php/apps/spreed/api/v4/room/${talkToken}/participants`, { newParticipant: uid, source: 'users' })).status).toBe(200)
	}
	expect((await alice.call('POST', `/ocs/v2.php/apps/spreed/api/v1/chat/${talkToken}`, { message: `Join me: ${office.url}` })).status).toBe(201)

	const member = await login(browser, 'bao')
	await member.goto(`/index.php/call/${talkToken}`)
	const card = member.locator('.vo-card')
	await expect(card).toBeVisible({ timeout: 20_000 })
	await expect(card.locator('strong')).toHaveText(title)
	await expect(card.locator('.vo-card__art')).toHaveJSProperty('naturalWidth', 960)
	await expect(card.getByRole('link', { name: 'Open office' })).toHaveAttribute('href', office.url)
	await expect(card.locator('.vo-card__meta')).toContainText('Nobody there')

	const outsider = await login(browser, 'chi')
	await outsider.goto(`/index.php/call/${talkToken}`)
	const hidden = outsider.locator('.vo-card')
	await expect(hidden).toBeVisible({ timeout: 20_000 })
	await expect(hidden.locator('.vo-card__meta')).toHaveText('This office is not available to you')
	await expect(outsider.getByText(title)).toHaveCount(0)

	// Opening the card never enters the office.
	expect(await member.locator('.vo-card').count()).toBe(1)
	await member.context().close()
	await outsider.context().close()
})

test('Smart Picker offers the office search', async () => {
	const alice = await Api.as('alice')
	const providers = await alice.call('GET', '/ocs/v2.php/references/providers')
	const provider = providers.data.find((p: any) => p.id === 'virtualoffice')
	expect(provider).toMatchObject({ title: 'Virtual Office', search_providers_ids: ['virtualoffice'] })
})

test('a conversation gets its own office, used right inside Talk', async ({ browser }) => {
	const alice = await Api.as('alice')
	const TALK = '/ocs/v2.php/apps/spreed/api/v4'
	const room = await alice.call('POST', `${TALK}/room`, { roomType: 2, roomName: uniqueName('Weekly retro') })
	const talk = room.data.token
	for (const uid of ['bao', 'chi']) {
		await alice.call('POST', `${TALK}/room/${talk}/participants`, { newParticipant: uid, source: 'users' })
	}
	await alice.call('POST', `/ocs/v2.php/apps/spreed/api/v1/chat/${talk}`, { message: 'Welcome to the retro' })

	// Alice opens the office from a message menu, then shares and pins it.
	const a = await login(browser, 'alice', TALK_CONTEXT)
	await a.goto(`/index.php/call/${talk}`)
	const message = a.locator('[class*="message"]').filter({ hasText: 'Welcome to the retro' }).last()
	const more = a.locator('[class*="buttons-bar"]').getByRole('button', { name: 'More actions' }).last()
	await expect(async () => {
		await message.hover()
		await expect(more).toBeVisible({ timeout: 1000 })
	}).toPass({ timeout: 15_000 })
	await more.click()
	const [door] = await Promise.all([a.context().waitForEvent('page'), a.getByRole('menuitem', { name: 'Open conversation office' }).click()])
	await expect(door.getByText('Pin it at the top of the chat')).toBeVisible({ timeout: 20_000 })
	await door.getByRole('button', { name: 'Open the office' }).click()
	await door.waitForURL(/\/apps\/virtualoffice\/o\//)
	await expect(door.getByText(/Talk conversation Weekly retro/)).toBeVisible()
	await door.getByRole('button', { name: 'Enter office' }).click()
	await expect(door.locator('.room')).toBeVisible()
	await door.getByRole('button', { name: 'Share to chat' }).click()
	await expect(door.getByText('Posted to the conversation')).toBeVisible()
	const chat = await alice.call('GET', `/ocs/v2.php/apps/spreed/api/v1/chat/${talk}?lookIntoFuture=0&limit=5`)
	expect(chat.data.some((m: any) => m.message.startsWith('I am in the office, come by'))).toBe(true)
	await a.reload()
	await expect(a.getByText('This conversation now has an office').first()).toBeVisible({ timeout: 20_000 })

	// Bao reads who is inside on the card and enters from inside Talk.
	const b = await login(browser, 'bao', TALK_CONTEXT)
	await b.goto(`/index.php/call/${talk}`)
	const card = b.locator('.vo-card').first()
	await expect(card.locator('.vo-card__meta')).toContainText('Alice there', { timeout: 20_000 })
	await b.getByRole('button', { name: 'Enable interactive view' }).first().click()
	await b.locator('.vo-card__embed').getByRole('button', { name: 'Enter office' }).click()
	await expect(b.locator('.vo-card__embed .vo-scene')).toBeVisible()
	await expect(door.locator('.vo-actor[data-uid="bao"]')).toBeVisible({ timeout: 10_000 })
	await b.locator('.vo-card__embed').getByRole('button', { name: 'Wave' }).click()
	await expect(door.locator('.vo-actor[data-uid="bao"] .vo-emote.vo-visible')).toBeVisible({ timeout: 5000 })

	// Chi starts the call in Talk; the office shows it with a headset on nobody inside yet.
	const c = await login(browser, 'chi', TALK_CONTEXT)
	await c.goto(`/index.php/call/${talk}`)
	await c.getByRole('button', { name: /Start call|Join call/ }).first().click()
	const confirm = c.getByRole('dialog').getByRole('button', { name: /Start call|Join call/ })
	if (await confirm.count()) {
		await confirm.first().click()
	}
	await expect(door.locator('.room__call')).toContainText('Call in progress with Chi', { timeout: 15_000 })
	await expect(door.locator('.room__call').getByRole('button', { name: 'Join call' })).toBeVisible()

	// Leaving Talk's message view leaves the office.
	await b.goto('/index.php/apps/files/')
	await expect(door.locator('.vo-actor[data-uid="bao"]')).toHaveCount(0, { timeout: 5000 })
	for (const page of [a, b, c]) {
		await page.context().close()
	}
})

test('members who are not managers can share the office to its conversation', async ({ browser }) => {
	const alice = await Api.as('alice')
	const bao = await Api.as('bao')
	const TALK = '/ocs/v2.php/apps/spreed/api/v4'
	const room = await alice.call('POST', `${TALK}/room`, { roomType: 2, roomName: uniqueName('Share test') })
	await alice.call('POST', `${TALK}/room/${room.data.token}/participants`, { newParticipant: 'bao', source: 'users' })
	const office = (await alice.call('POST', `/conversations/${room.data.token}/office`)).data.office
	expect((await bao.call('GET', `/offices/${office.token}`)).data.permissions.canManage).toBe(false)

	const b = await login(browser, 'bao')
	await b.goto(office.url)
	await b.getByRole('button', { name: 'Enter office' }).click()
	await b.getByRole('button', { name: 'Share to chat' }).click()
	await expect(b.getByText('Posted to the conversation')).toBeVisible()
	const chat = await bao.call('GET', `/ocs/v2.php/apps/spreed/api/v1/chat/${room.data.token}?lookIntoFuture=0&limit=5`)
	expect(chat.data.some((m: any) => m.actorId === 'bao' && m.message.includes(office.url))).toBe(true)
	await b.context().close()
})
