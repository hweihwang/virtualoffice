/**
 * SPDX-FileCopyrightText: 2026 Hoang Pham
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
import type { Page } from '@playwright/test'

import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'
import { Api, clearPresence, createTeam, login, uniqueName } from './helpers.ts'

let token: string

test.beforeAll(async () => {
	const alice = await Api.as('alice')
	const team = createTeam('alice', uniqueName('A11y Team'), ['bao'])
	token = (await alice.call('POST', '/offices', { title: uniqueName('Accessible office'), audience: { kind: 'team', id: team } })).data.token
})

test.beforeEach(() => clearPresence())

/** Serious and critical problems inside the app; core chrome is out of scope. */
async function violations(page: Page) {
	const results = await new AxeBuilder({ page }).include('#virtualoffice').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()
	return results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)
}

test('directory, landing and room have no serious accessibility problems', async ({ browser }) => {
	const page = await login(browser, 'alice')
	await page.goto('/index.php/apps/virtualoffice/')
	await expect(page.getByRole('heading', { name: 'Offices' })).toBeVisible()
	expect(await violations(page)).toEqual([])

	await page.goto(`/index.php/apps/virtualoffice/o/${token}`)
	await expect(page.getByRole('button', { name: 'Enter office' })).toBeVisible()
	await expect(page.locator('.landing__preview')).toHaveJSProperty('naturalWidth', 960)
	expect(await violations(page)).toEqual([])

	await page.getByRole('button', { name: 'Enter office' }).click()
	await expect(page.locator('.room')).toBeVisible()
	expect(await violations(page)).toEqual([])

	await page.getByRole('button', { name: 'List' }).click()
	expect(await violations(page)).toEqual([])
	await page.getByRole('button', { name: 'Map' }).click()
	await page.context().close()
})

test('everything works from the keyboard', async ({ browser }) => {
	const page = await login(browser, 'alice')
	await page.goto(`/index.php/apps/virtualoffice/o/${token}`)
	await page.getByRole('button', { name: 'Enter office' }).focus()
	await page.keyboard.press('Enter')
	await expect(page.locator('.room')).toBeVisible()
	// Entering focuses the map, so arrow keys walk right away.
	await expect(page.getByRole('application', { name: 'Office map' })).toBeFocused()
	await page.keyboard.press('Escape')
	await expect(page.getByRole('application', { name: 'Office map' })).not.toBeFocused()

	const desks = page.locator('.people__zone').filter({ has: page.getByRole('heading', { name: /Focus desks/ }) })
	await desks.getByRole('button', { name: 'Go here' }).focus()
	await page.keyboard.press('Enter')
	await expect(desks.getByText('Alice (you)')).toBeVisible({ timeout: 8000 })
	await page.getByRole('button', { name: 'Wave' }).focus()
	await page.keyboard.press('Enter')
	await expect(page.locator('.vo-actor[data-uid="alice"] .vo-emote.vo-visible')).toBeVisible()
	await page.getByRole('button', { name: 'Leave' }).focus()
	await page.keyboard.press('Enter')
	await expect(page.getByRole('button', { name: 'Enter office' })).toBeVisible()
	await page.context().close()
})

test('reduced motion keeps positions but stops decorative animation', async ({ browser }) => {
	const context = await browser.newContext({ reducedMotion: 'reduce' })
	await context.close()
	const page = await login(browser, 'alice')
	await page.emulateMedia({ reducedMotion: 'reduce' })
	await page.goto(`/index.php/apps/virtualoffice/o/${token}`)
	await page.getByRole('button', { name: 'Enter office' }).click()
	await page.getByRole('button', { name: 'Wave' }).click()
	const animation = await page.locator('.vo-actor[data-uid="alice"] .vo-emote svg').evaluate((el) => getComputedStyle(el).animationName)
	expect(animation).toBe('none')
	await page.context().close()
})

test('zoomed to 400% the room reflows into one column', async ({ browser }) => {
	const page = await login(browser, 'alice')
	await page.setViewportSize({ width: 320, height: 640 })
	await page.goto(`/index.php/apps/virtualoffice/o/${token}`)
	await page.getByRole('button', { name: 'Enter office' }).click()
	await expect(page.locator('.room')).toBeVisible()
	const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
	expect(overflow).toBeLessThanOrEqual(1)
	await expect(page.getByRole('button', { name: 'Leave' })).toBeVisible()
	await page.context().close()
})
