/**
 * SPDX-FileCopyrightText: 2026 Hoang Pham
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
import { expect, test } from '@playwright/test'
import { Api, clearPresence, createTeam, PASSWORD, uniqueName } from './helpers.ts'

test.beforeEach(() => clearPresence())

test('on a phone the list is the default and tapping the map walks', async ({ page }) => {
	await (await Api.as('bao')).call('DELETE', '/me/preferences')
	const alice = await Api.as('alice')
	const team = createTeam('alice', uniqueName('Mobile Team'), ['bao'])
	const token = (await alice.call('POST', '/offices', { title: uniqueName('Pocket office'), audience: { kind: 'team', id: team } })).data.token

	await page.goto('/login')
	await page.locator('#user').fill('bao')
	await page.locator('#password').fill(PASSWORD)
	await page.locator('button[type=submit]').click()
	await page.waitForURL(/\/apps\//)
	await page.goto(`/index.php/apps/virtualoffice/o/${token}`)
	await page.getByRole('button', { name: 'Enter office' }).tap()
	await expect(page.locator('.people')).toBeVisible()
	await expect(page.locator('.office-scene')).toHaveCount(0)

	await page.getByRole('button', { name: 'Map' }).tap()
	const stage = page.locator('.vo-stage')
	await expect(stage).toBeVisible()
	const before = await page.locator('.vo-actor[data-uid="bao"]').getAttribute('style')
	const box = (await stage.boundingBox())!
	const scale = box.width / 1280
	await page.touchscreen.tap(box.x + (5 * 40 + 20) * scale, box.y + (13 * 40 + 20) * scale)
	await expect.poll(async () => page.locator('.vo-actor[data-uid="bao"]').getAttribute('style'), { timeout: 5000 }).not.toBe(before)
	// Nextcloud's default clickable area is 34 px.
	const buttons = await page.locator('.controls button, .people button').evaluateAll((els) => els.map((el) => el.getBoundingClientRect().height))
	expect(Math.min(...buttons)).toBeGreaterThanOrEqual(34)
})
