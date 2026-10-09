import type { Cell } from '../shared/catalog.ts'
/**
 * SPDX-FileCopyrightText: 2026 Hoang Pham
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
import type { Audience, CallState, DeskList, EventBatch, FocusState, MusicState, OfficeDefinition, Participant, Preferences, Snapshot, TeamResource } from './types.ts'

import axios, { isAxiosError } from '@nextcloud/axios'
import { generateOcsUrl } from '@nextcloud/router'

export class ApiError extends Error {
	constructor(
		public status: number,
		public code: string,
		message: string,
		public data: Record<string, unknown> = {},
	) {
		super(message)
	}

	/** Network failure or server trouble that is worth retrying. */
	get retryable(): boolean {
		return this.status === 0 || this.status >= 500 || this.code === 'RATE_LIMITED'
	}
}

const base = (path: string) => generateOcsUrl('/apps/virtualoffice/api/v1' + path)

async function request<T>(method: 'get' | 'post' | 'put' | 'patch' | 'delete', path: string, data?: unknown, headers?: Record<string, string>): Promise<T> {
	try {
		const response = await axios.request({ method, url: base(path), data, headers, params: method === 'get' ? data : undefined })
		return response.data.ocs.data as T
	} catch (error) {
		if (isAxiosError(error)) {
			const payload = error.response?.data?.ocs?.data
			throw new ApiError(
				error.response?.status ?? 0,
				payload?.code ?? (error.response ? 'HTTP_' + error.response.status : 'NETWORK'),
				payload?.message ?? error.message,
				payload?.data ?? {},
			)
		}
		throw error
	}
}

export const api = {
	listOffices: (search = '', offset = 0, conversations: string[] | null = null) => conversations === null
		? request<OfficeDefinition[]>('get', '/offices', { search, limit: 50, offset })
		: request<OfficeDefinition[]>('post', '/offices/directory', { search, limit: 50, offset, conversations }),
	getOffice: (token: string) => request<OfficeDefinition>('get', `/offices/${token}`),
	createOffice: (title: string, audience: Pick<Audience, 'kind' | 'id'>, managerUid?: string, layoutId?: string) => request<OfficeDefinition>('post', '/offices', { title, audience, managerUid, layoutId }),
	updateOffice: (token: string, revision: number, patch: Record<string, unknown>) => request<OfficeDefinition>('patch', `/offices/${token}`, patch, { 'If-Match': `"${revision}"` }),
	deleteOffice: (token: string, revision: number) => request<[]>('delete', `/offices/${token}`, undefined, { 'If-Match': `"${revision}"` }),
	audiences: (search = '') => request<Audience[]>('get', '/audiences', { search }),
	conversationOffice: (conversation: string) => request<{ office: OfficeDefinition, created: boolean }>('post', `/conversations/${conversation}/office`),
	people: (token: string, search: string) => request<{ uid: string, displayName: string }[]>('get', `/offices/${token}/people`, { search }),
	talkConversations: (token: string) => request<{ token: string, label: string }[]>('get', `/offices/${token}/talk-conversations`),
	card: (token: string) => request<OfficeCard>('get', `/offices/${token}/card`),
	summaries: (tokens: string[]) => request<{ token: string, count: number, observedAt: number }[]>('post', '/summaries', { tokens }),
	addManager: (token: string, uid: string) => request<OfficeDefinition>('put', `/offices/${token}/managers`, { uid }),
	removeManager: (token: string, uid: string) => request<OfficeDefinition>('delete', `/offices/${token}/managers`, { uid }),
	removePerson: (token: string, uid: string, minutes: number) => request<OfficeDefinition>('put', `/offices/${token}/removals`, { uid, minutes }),
	liftRemoval: (token: string, uid: string) => request<OfficeDefinition>('delete', `/offices/${token}/removals`, { uid }),

	enter: (token: string, session: string, takeover: boolean) => request<Snapshot>('post', `/offices/${token}/room/enter`, { session, takeover }),
	poll: (token: string, session: string, rev: number) => request<({ changed: false, rev: number, serverTime: number, signals?: Signal[] }) | ({ changed: true, signals?: Signal[] } & Snapshot)>('get', `/offices/${token}/room`, { session, rev }),
	move: (token: string, session: string, path: Cell[]) => request<OwnChange>('post', `/offices/${token}/room/move`, { session, path }),
	stop: (token: string, session: string) => request<OwnChange>('post', `/offices/${token}/room/stop`, { session }),
	emote: (token: string, session: string, emote: string) => request<OwnChange>('post', `/offices/${token}/room/emote`, { session, emote }),
	mode: (token: string, session: string, mode: string) => request<OwnChange>('post', `/offices/${token}/room/mode`, { session, mode }),
	profile: (token: string, session: string) => request<OwnChange>('post', `/offices/${token}/room/profile`, { session }),
	interact: (token: string, session: string, prop: string) => request<{ outcome: 'started' | 'already-active', rev?: number, serverTime: number }>('post', `/offices/${token}/room/interact`, { session, prop }),
	leave: (token: string, session: string) => request<[]>('post', `/offices/${token}/room/leave`, { session }),
	focus: (token: string, session: string, minutes: number) => request<{ focus: FocusState | null, serverTime: number }>('post', `/offices/${token}/room/focus`, { session, minutes }),
	leaveFocus: (token: string, session: string) => request<{ focus: FocusState | null, serverTime: number }>('post', `/offices/${token}/room/focus/leave`, { session }),
	startMusic: (token: string, session: string, tracks: { fileId: number, durationMs: number }[]) => request<{ music: MusicState | null, serverTime: number }>('post', `/offices/${token}/room/music`, { session, tracks }),
	stopMusic: (token: string, session: string) => request<{ music: MusicState | null, serverTime: number }>('post', `/offices/${token}/room/music/stop`, { session }),
	voice: (token: string, session: string, on: boolean) => request<OwnChange>('post', `/offices/${token}/room/voice`, { session, on }),
	signal: (token: string, session: string, to: string, body: SignalBody) => request<{ id: number, serverTime: number }>('post', `/offices/${token}/room/signal`, { session, to, body }),
	roulette: (token: string) => request<RouletteState>('get', `/offices/${token}/roulette`),
	joinRoulette: (token: string) => request<RouletteState>('put', `/offices/${token}/roulette`),
	leaveRoulette: (token: string) => request<RouletteState>('delete', `/offices/${token}/roulette`),
	desks: (token: string) => request<DeskList>('get', `/offices/${token}/desks`),
	claimDesk: (token: string, deskId: string) => request<DeskList>('put', `/offices/${token}/desks/${deskId}`),
	releaseDesk: (token: string, deskId: string) => request<DeskList>('delete', `/offices/${token}/desks/${deskId}`),
	resources: (token: string) => request<TeamResource[]>('get', `/offices/${token}/resources`),
	teamOffices: (conversation: string) => request<{ token: string, title: string, url: string }[]>('get', `/conversations/${conversation}/team-offices`),
	watching: (token: string) => request<WatchState>('get', `/offices/${token}/watch`),
	watch: (token: string, expiresAt: number) => request<WatchState>('put', `/offices/${token}/watch`, { expiresAt }),
	unwatch: (token: string) => request<WatchState>('delete', `/offices/${token}/watch`),
	knock: (token: string, uid: string) => request<{ id: number }>('post', `/offices/${token}/knocks`, { uid }),
	answerKnock: (id: number, answer: KnockAnswer) => request<{ link: string | null }>('post', `/knocks/${id}`, { answer }),

	preferences: () => request<{ revision: number, preferences: Preferences | null }>('get', '/me/preferences'),
	savePreferences: (revision: number, preferences: Preferences) => request<{ revision: number, preferences: Preferences }>('put', '/me/preferences', { revision, preferences }),
	today: () => request<{ today: TodayNote | null }>('get', '/me/today'),
	setToday: (text: string, expiresAt: number) => request<{ today: TodayNote | null }>('put', '/me/today', { text, expiresAt }),

	adminSettings: () => request<AdminSettings>('get', '/admin/settings'),
	saveAdminSettings: (settings: Partial<AdminSettings>) => request<AdminSettings>('put', '/admin/settings', settings),
	adminOffices: (offset = 0) => request<OfficeDefinition[]>('get', '/admin/offices', { limit: 50, offset }),
}

export interface OfficeCard {
	token: string
	title: string
	audience: string
	count: number
	people: { uid: string, name: string }[]
	call: CallState | null
	observedAt: number
	canEnter: boolean
	layoutId: string
	clientPush: boolean
}

export interface RouletteState {
	available: boolean
	joined: boolean
}

export interface WatchState {
	watching: boolean
	expiresAt: number | null
}

export type KnockAnswer = 'now' | 'soon' | 'later'

/** Client Push message for a knock on you or the answer to your knock. */
export type KnockEvent
	= | { kind: 'knock', id: number, office: string, from: string, name: string }
		| { kind: 'answer', answer: KnockAnswer, office: string, from: string, name: string, link: string | null }

/** A WebRTC offer, answer or goodbye between two tabs with voice on; candidates travel in the SDP. */
export interface SignalBody {
	type: 'offer' | 'answer' | 'bye'
	sdp?: string
}

/** A signal for this tab, from Client Push or the poll. */
export interface Signal {
	id: number
	from: string
	to?: string
	body: SignalBody
}

export interface TodayNote {
	text: string
	expiresAt: number
}

export interface OwnChange {
	rev: number
	serverTime: number
	participant: Participant
}

export interface AdminSettings {
	roomCapacity: number
	maxRoomCapacity: number
	instanceOffices: boolean
	voice: boolean
	clientPush: boolean
}

export type { EventBatch }
