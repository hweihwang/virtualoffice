/**
 * SPDX-FileCopyrightText: 2026 Hoang Pham
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
import type { APIRequestContext, Browser, Page } from '@playwright/test'

import { request } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { resolve } from 'node:path'

export const BASE = process.env.VO_BASE_URL ?? 'http://localhost:18935'
export const PASSWORD = 'virtualoffice-fixture-only'
const COMPOSE = resolve(import.meta.dirname, '../fixture/compose.yaml')

export interface Ocs<T = any> {
	status: number
	data: T
}

export class Api {
	private constructor(private ctx: APIRequestContext) {}

	static async as(user: string): Promise<Api> {
		return new Api(await request.newContext({
			baseURL: BASE,
			extraHTTPHeaders: {
				Authorization: 'Basic ' + Buffer.from(`${user}:${PASSWORD}`).toString('base64'),
				'OCS-APIRequest': 'true',
				Accept: 'application/json',
			},
		}))
	}

	async call<T = any>(method: string, path: string, data?: unknown, headers: Record<string, string> = {}): Promise<Ocs<T>> {
		const url = path.startsWith('/ocs/') || path.startsWith('/index.php') ? path : `/ocs/v2.php/apps/virtualoffice/api/v1${path}`
		const response = await this.ctx.fetch(url, { method, data: data === undefined ? undefined : data, headers: { 'Content-Type': 'application/json', ...headers }, maxRedirects: 0 })
		const text = await response.text()
		let body: any = text
		try {
			body = JSON.parse(text)?.ocs?.data ?? JSON.parse(text)
		} catch {
			// Not JSON, for example a redirect or an HTML error page.
		}
		return { status: response.status(), data: body }
	}

	async raw(method: string, path: string, headers: Record<string, string> = {}, data?: string | Buffer) {
		return this.ctx.fetch(path, { method, headers, data, maxRedirects: 0 })
	}

	dispose() {
		return this.ctx.dispose()
	}
}

export function session(): string {
	return randomBytes(16).toString('hex')
}

export function occ(...args: string[]): string {
	return execFileSync('docker', ['compose', '-f', COMPOSE, 'exec', '-T', '-u', 'www-data', '-e', `NC_PASS=${PASSWORD}`, 'app', 'php', 'occ', ...args], { encoding: 'utf8' })
}

export function sql(query: string): string {
	return execFileSync('docker', ['compose', '-f', COMPOSE, 'exec', '-T', 'database', 'psql', '-U', 'virtualoffice_fixture', '-d', 'virtualoffice_fixture', '-tAc', query], { encoding: 'utf8' }).trim()
}

/** Creates a Team owned by `owner` with the given members and returns its id. */
export function createTeam(owner: string, name: string, members: string[]): string {
	const created = JSON.parse(occ('circles:manage:create', '--type', 'user', '--output=json', owner, name))
	for (const member of members) {
		occ('circles:members:add', '--type', 'user', created.id, member)
	}
	return created.id
}

/** Removes a member the way the Contacts app does: a web request by the Team owner. */
export async function removeFromTeam(owner: Api, teamId: string, uid: string): Promise<void> {
	const members = JSON.parse(occ('circles:members:list', '--output=json', teamId))
	const member = members.find((m: any) => m.userId === uid)
	const result = await owner.call('DELETE', `/ocs/v2.php/apps/circles/circles/${teamId}/members/${member.id}`)
	if (result.status !== 200) {
		throw new Error(`Could not remove ${uid} from Team: ${result.status}`)
	}
}

/** A short mono WAV with a tone, as a file anyone's browser can play. */
export function toneWav(seconds = 4, hz = 440, rate = 8000): Buffer {
	const samples = seconds * rate
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
		wav.writeInt16LE(Math.round(Math.sin(2 * Math.PI * hz * i / rate) * 12000), 44 + i * 2)
	}
	return wav
}

/** Uploads a file to the user's Files and returns its file id. */
export async function upload(api: Api, user: string, name: string, data: Buffer, type: string): Promise<number> {
	const path = `/remote.php/dav/files/${user}/${encodeURIComponent(name)}`
	const put = await api.raw('PUT', path, { 'Content-Type': type }, data)
	if (put.status() >= 300) {
		throw new Error(`Upload failed: ${put.status()}`)
	}
	const found = await api.raw('PROPFIND', path, { Depth: '0', 'Content-Type': 'application/xml' }, '<d:propfind xmlns:d="DAV:" xmlns:oc="http://owncloud.org/ns"><d:prop><oc:fileid/></d:prop></d:propfind>')
	return Number((await found.text()).match(/<oc:fileid>(\d+)<\/oc:fileid>/)![1])
}

export function uniqueName(prefix: string): string {
	return `${prefix} ${randomBytes(3).toString('hex')}`
}

/** Talk warns about headless user agents and needs media permissions for calls. */
export const TALK_CONTEXT = {
	userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36',
	permissions: ['camera', 'microphone'],
}

export async function login(browser: Browser, user: string, options: Record<string, unknown> = {}): Promise<Page> {
	const context = await browser.newContext({ baseURL: BASE, ...options })
	const page = await context.newPage()
	await page.goto('/login')
	await page.locator('#user').fill(user)
	await page.locator('#password').fill(PASSWORD)
	await page.locator('button[type=submit]').click()
	await page.waitForURL(/\/apps\//)
	return page
}

/** Everyone leaves every office, so tests start from an empty room. */
export function clearPresence(): void {
	sql('DELETE FROM oc_vo_presence')
}

export async function waitFor<T>(fn: () => Promise<T | undefined | false> | T | undefined | false, timeout = 10_000, interval = 100): Promise<T> {
	const until = Date.now() + timeout
	for (;;) {
		const value = await fn()
		if (value) {
			return value as T
		}
		if (Date.now() > until) {
			throw new Error('Timed out waiting')
		}
		await new Promise((r) => setTimeout(r, interval))
	}
}
