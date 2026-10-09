/**
 * SPDX-FileCopyrightText: 2026 Hoang Pham
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
import type { Browser, Page } from '@playwright/test'
import type { Cell } from '../../shared/catalog.ts'

import { expect, test } from '@playwright/test'
import { getLayout } from '../../shared/catalog.ts'
import { Api, clearPresence, createTeam, login, uniqueName } from './helpers.ts'

/**
 * Proximity voice between two Chromium windows with fake microphones that
 * play a tone. Run once on a push fixture and once with VO_TRANSPORT=polling.
 */
const PUSH = (process.env.VO_TRANSPORT ?? 'push') === 'push'
const CONNECT_WITHIN = PUSH ? 3000 : 6000
/** VO_TURN=1 after tests/fixture/setup.sh push turn: browsers may only use relayed candidates, as on a network that only lets TURN through. */
const TURN_ONLY = process.env.VO_TURN === '1'
const layout = getLayout('starter-office-v1')

/**
 * Keeps every peer connection and microphone track, and measures how loud
 * the sound arriving from others is, so the test can look at them.
 */
function watchMedia(relayOnly: boolean) {
	const w = window as any
	w.__pcs = []
	w.__tracks = []
	w.__level = 0
	// Safari starts audio only from a click, like the office itself.
	let context: AudioContext | null = null
	document.addEventListener('pointerdown', () => {
		context ??= new AudioContext()
		void context.resume()
	}, true)
	const Original = window.RTCPeerConnection
	window.RTCPeerConnection = class extends Original {
		constructor(config?: RTCConfiguration) {
			super(relayOnly ? { ...config, iceTransportPolicy: 'relay' } : config)
			w.__pcs.push(this)
			this.addEventListener('track', (event) => {
				context ??= new AudioContext()
				const analyser = context.createAnalyser()
				context.createMediaStreamSource(event.streams[0]).connect(analyser)
				const data = new Uint8Array(analyser.fftSize)
				// The fake microphone beeps once a second: keep the loudest moment of the last 1.5 seconds.
				const recent: [number, number][] = []
				setInterval(() => {
					analyser.getByteTimeDomainData(data)
					const now = performance.now()
					recent.push([now, Math.max(...Array.from(data, (v) => Math.abs(v - 128)))])
					while (recent[0][0] < now - 1500) {
						recent.shift()
					}
					w.__level = Math.max(...recent.map(([, level]) => level))
				}, 50)
			})
		}
	} as typeof RTCPeerConnection
	// The office's own volume and left/right nodes for each person it hears.
	w.__gains = []
	w.__pans = []
	const createGain = AudioContext.prototype.createGain
	AudioContext.prototype.createGain = function() {
		const node = createGain.call(this)
		w.__gains.push(node)
		return node
	}
	const createStereoPanner = AudioContext.prototype.createStereoPanner
	AudioContext.prototype.createStereoPanner = function() {
		const node = createStereoPanner.call(this)
		w.__pans.push(node)
		return node
	}
	const getUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)
	navigator.mediaDevices.getUserMedia = async (constraints) => {
		const stream = await getUserMedia(constraints)
		w.__tracks.push(...stream.getTracks())
		return stream
	}
}

async function openOffice(browser: Browser, uid: string, token: string): Promise<Page> {
	const page = await login(browser, uid, { permissions: ['microphone'] })
	await page.addInitScript(watchMedia, TURN_ONLY)
	await page.goto(`/apps/virtualoffice/o/${token}`)
	await page.getByRole('button', { name: 'Enter office' }).click()
	await expect(page.locator('.vo-actor.vo-you')).toBeVisible()
	return page
}

/** Clicks a cell of the map, as people do to walk there. */
async function clickCell(page: Page, cell: Cell): Promise<void> {
	const [x, y] = cell
	const box = (await page.locator('.vo-stage').boundingBox())!
	const scale = box.width / (layout.width * layout.tileSize)
	await page.mouse.click(box.x + (x + 0.5) * layout.tileSize * scale, box.y + (y + 0.5) * layout.tileSize * scale)
}

/** Candidate types of the pair each connected peer uses, e.g. "relay/relay". */
function routes(page: Page) {
	return page.evaluate(async () => {
		const result: string[] = []
		for (const pc of (window as any).__pcs as RTCPeerConnection[]) {
			if (pc.connectionState !== 'connected') {
				continue
			}
			const stats = await pc.getStats()
			stats.forEach((pair: any) => {
				if (pair.type === 'candidate-pair' && pair.nominated && pair.state === 'succeeded') {
					result.push(`${stats.get(pair.localCandidateId)?.candidateType}/${stats.get(pair.remoteCandidateId)?.candidateType}`)
				}
			})
		}
		return result
	})
}

const connected = (page: Page) => page.evaluate(() => (window as any).__pcs.filter((pc: RTCPeerConnection) => pc.connectionState === 'connected').length)

/** How loud the sound from others is right now, 0 to 128. */
const received = (page: Page) => page.evaluate(() => (window as any).__level as number)

test.describe(`proximity voice (${PUSH ? 'push' : 'polling'})`, () => {
	// Start from push to talk, whatever earlier visits saved.
	test.beforeEach(async () => {
		for (const uid of ['alice', 'bao']) {
			const api = await Api.as(uid)
			await api.call('DELETE', '/me/preferences')
			await api.dispose()
		}
	})

	test('people close by hear each other; walking away or to the focus desks hangs up', async ({ browser, browserName, playwright }) => {
		clearPresence()
		const team = createTeam('alice', uniqueName('Voice Team'), ['bao'])
		const owner = await Api.as('alice')
		const office = (await owner.call('POST', '/offices', { title: uniqueName('Voice office'), audience: { kind: 'team', id: team } })).data
		await owner.dispose()

		// Two browsers, as on two computers: Safari lets only one page use the microphone at a time.
		const second = await playwright[browserName].launch(test.info().project.use.launchOptions)
		// Bảo arrives next to Alice at the coffee corner.
		const alice = await openOffice(browser, 'alice', office.token)
		const bao = await openOffice(second, 'bao', office.token)
		await expect(bao.locator('.vo-actor')).toHaveCount(2)

		await alice.getByRole('button', { name: 'Turn on voice' }).click()
		await expect(alice.getByRole('button', { name: 'Hold to talk (V)' })).toBeVisible()
		await expect(bao.locator('.vo-actor:not(.vo-you).vo-voice')).toBeVisible()
		const started = Date.now()
		await bao.getByRole('button', { name: 'Turn on voice' }).click()
		for (const page of [alice, bao]) {
			await expect(page.getByText('You can hear 1 person nearby')).toBeVisible({ timeout: CONNECT_WITHIN })
		}
		const took = Date.now() - started
		console.log(`voice connected after ${took} ms (${PUSH ? 'push' : 'polling'})`)
		expect(took).toBeLessThan(CONNECT_WITHIN)
		expect(await connected(alice)).toBe(1)
		if (TURN_ONLY) {
			const used = [...await routes(alice), ...await routes(bao)]
			console.log(`voice routes: ${used.join(', ')}`)
			expect(used.length).toBeGreaterThan(0)
			expect(used.every((route) => route.startsWith('relay/'))).toBe(true)
		}

		// Push to talk: Bảo hears Alice only while she holds V.
		await alice.locator('.office-scene').focus()
		await expect.poll(() => received(bao)).toBeLessThan(5)
		await alice.keyboard.down('v')
		await expect(alice.getByRole('button', { name: 'Talking…' })).toBeVisible()
		await expect.poll(() => received(bao), { timeout: 5000 }).toBeGreaterThan(20)
		await expect(bao.locator('.vo-actor:not(.vo-you).vo-speaking')).toBeVisible()
		await alice.keyboard.up('v')
		await expect.poll(() => received(bao), { timeout: 5000 }).toBeLessThan(5)

		// Bảo walks over to the common room: another zone, so the connection ends.
		await clickCell(bao, [17, 13])
		for (const page of [alice, bao]) {
			await expect(page.getByText('Walk up to people with a microphone to talk. Focus desks stay quiet.')).toBeVisible({ timeout: 10_000 })
		}
		await expect.poll(() => connected(alice)).toBe(0)

		// Alice joins him there; then he walks to the far end of the room, more than 7 cells away.
		await clickCell(alice, [15, 13])
		await expect(alice.getByText('You can hear 1 person nearby')).toBeVisible({ timeout: 10_000 })
		await clickCell(bao, [21, 2])
		await expect(alice.getByText('Walk up to people with a microphone to talk. Focus desks stay quiet.')).toBeVisible({ timeout: 10_000 })
		await expect.poll(() => connected(alice)).toBe(0)

		// Both go to the focus desks, side by side: a quiet zone, so nobody connects.
		await clickCell(alice, [26, 6])
		await clickCell(bao, [27, 6])
		await alice.waitForTimeout(6000)
		expect(await connected(alice)).toBe(0)
		await expect(alice.getByText('You can hear 1 person nearby')).toHaveCount(0)

		// Turning voice off closes the microphone, so the browser's indicator goes out.
		await alice.getByRole('button', { name: 'Turn off voice' }).click()
		await expect(alice.getByRole('button', { name: 'Turn on voice' })).toBeVisible()
		expect(await alice.evaluate(() => (window as any).__tracks.every((t: MediaStreamTrack) => t.readyState === 'ended'))).toBe(true)
		await expect(bao.locator('.vo-actor:not(.vo-you).vo-voice')).toHaveCount(0)

		await alice.context().close()
		await second.close()
	})

	test('an open mic is heard without a key, louder up close and from the side the person stands on', async ({ browser, browserName, playwright }) => {
		clearPresence()
		const team = createTeam('alice', uniqueName('Open mic Team'), ['bao'])
		const owner = await Api.as('alice')
		const office = (await owner.call('POST', '/offices', { title: uniqueName('Open mic'), audience: { kind: 'team', id: team } })).data
		await owner.dispose()
		const baoApi = await Api.as('bao')
		const { revision } = (await baoApi.call('GET', '/me/preferences')).data
		await baoApi.call('PUT', '/me/preferences', { revision, preferences: { appearance: { creature: 'cat', palette: 'sky', accessory: 'none' }, ui: { view: 'scene', reducedEffects: false, announcements: true, voiceMode: 'open' } } })
		const second = await playwright[browserName].launch(test.info().project.use.launchOptions)
		try {
			const alice = await openOffice(browser, 'alice', office.token)
			const bao = await openOffice(second, 'bao', office.token)
			for (const page of [alice, bao]) {
				await page.getByRole('button', { name: 'Turn on voice' }).click()
			}
			await expect(alice.getByText('You can hear 1 person nearby')).toBeVisible({ timeout: CONNECT_WITHIN })
			await expect(bao.getByRole('button', { name: 'Mute (M)' })).toBeVisible()
			// Bảo's mic is open: Alice hears him without anyone holding a key.
			await expect.poll(() => received(alice), { timeout: 5000 }).toBeGreaterThan(20)
			await bao.locator('.office-scene').focus()
			await bao.keyboard.press('m')
			await expect(bao.getByRole('button', { name: 'Unmute (M)' })).toBeVisible()
			await expect.poll(() => received(alice), { timeout: 5000 }).toBeLessThan(5)
			await bao.keyboard.press('m')

			// Alice stands at the coffee corner (5, 5). Two cells to her left Bảo sounds full and from the left...
			const mix = () => alice.evaluate(() => ({ gain: (window as any).__gains.at(-1)?.gain.value as number, pan: (window as any).__pans.at(-1)?.pan.value as number }))
			await clickCell(bao, [3, 5])
			await expect.poll(async () => (await mix()).pan, { timeout: 8000 }).toBeLessThan(-0.2)
			expect((await mix()).gain).toBeGreaterThan(0.9)
			// ...four cells to her right he is quieter and from the right.
			await clickCell(bao, [9, 5])
			await expect.poll(async () => (await mix()).pan, { timeout: 8000 }).toBeGreaterThan(0.2)
			await expect.poll(async () => (await mix()).gain, { timeout: 3000 }).toBeLessThan(0.6)
			expect((await mix()).gain).toBeGreaterThan(0.05)
			await alice.context().close()
		} finally {
			await second.close()
			await baoApi.call('DELETE', '/me/preferences')
			await baoApi.dispose()
		}
	})

	test('the on-screen Talk button sends while it is held', async ({ browser }) => {
		clearPresence()
		const owner = await Api.as('alice')
		const team = createTeam('alice', uniqueName('Talk button Team'), ['bao'])
		const office = (await owner.call('POST', '/offices', { title: uniqueName('Talk button'), audience: { kind: 'team', id: team } })).data
		await owner.dispose()
		const alice = await openOffice(browser, 'alice', office.token)
		await alice.getByRole('button', { name: 'Turn on voice' }).click()
		await alice.getByRole('button', { name: 'Hold to talk (V)' }).hover()
		await alice.mouse.down()
		await expect(alice.getByRole('button', { name: 'Talking…' })).toBeVisible()
		expect(await alice.evaluate(() => (window as any).__tracks.some((t: MediaStreamTrack) => t.enabled))).toBe(true)
		await alice.mouse.up()
		await expect(alice.getByRole('button', { name: 'Hold to talk (V)' })).toBeVisible()
		expect(await alice.evaluate(() => (window as any).__tracks.every((t: MediaStreamTrack) => !t.enabled))).toBe(true)
		await alice.context().close()
	})
})
