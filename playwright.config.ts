/**
 * SPDX-FileCopyrightText: 2026 Hoang Pham
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
import { defineConfig, devices } from '@playwright/test'

/**
 * Runs against the fixture in tests/fixture (start it with tests/fixture/setup.sh).
 * Tests share accounts and presence, so they run one at a time.
 */
export default defineConfig({
	testDir: 'tests/e2e',
	workers: 1,
	fullyParallel: false,
	timeout: 90_000,
	expect: { timeout: 10_000 },
	reporter: [['list']],
	use: {
		baseURL: process.env.VO_BASE_URL ?? 'http://localhost:18935',
		trace: 'retain-on-failure',
	},
	projects: [
		{ name: 'api', testMatch: /api\.spec\.ts/ },
		{ name: 'chromium', testMatch: /room\.spec\.ts|a11y\.spec\.ts|talk\.spec\.ts/, use: { ...devices['Desktop Chrome'] } },
		{
			name: 'voice',
			testMatch: /voice\.spec\.ts/,
			// A fake microphone that plays a beep, granted without a prompt.
			use: { ...devices['Desktop Chrome'], permissions: ['microphone'], launchOptions: { args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] } },
		},
		{ name: 'voice-webkit', testMatch: /voice\.spec\.ts/, use: { ...devices['Desktop Safari'], permissions: ['microphone'] } },
		{ name: 'firefox', testMatch: /room\.spec\.ts/, use: { ...devices['Desktop Firefox'] } },
		{ name: 'webkit', testMatch: /room\.spec\.ts/, use: { ...devices['Desktop Safari'] } },
		{
			name: 'mobile',
			testMatch: /mobile\.spec\.ts/,
			// Nextcloud 35 requires Safari on iOS 26.1 or newer; the device preset reports an older version.
			use: { ...devices['iPhone 13'], userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.1 Mobile/15E148 Safari/604.1' },
		},
	],
})
