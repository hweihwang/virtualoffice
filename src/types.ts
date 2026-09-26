/**
 * SPDX-FileCopyrightText: 2026 Hoang Pham
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
import type { Appearance } from '../shared/catalog.ts'
import type { Trajectory } from '../shared/movement.ts'

export type AudienceKind = 'team' | 'group' | 'instance' | 'talk'

export interface Audience {
	kind: AudienceKind
	id: string
	label: string
}

export interface TalkBinding {
	source: 'team' | 'link' | 'conversation'
	label: string
	token?: string
}

export interface CallState {
	/** False until Talk reported a call event after the office was linked. */
	known: boolean
	active: boolean
	since: number | null
	participants: string[]
	names: Record<string, string>
}

export interface OfficeDefinition {
	token: string
	title: string
	audience: Audience
	layoutId: string
	revision: number
	config: { decor: Record<string, string>, talk: TalkBinding | null }
	permissions: { isMember: boolean, canEnter: boolean, canManage: boolean }
	removedUntil: number | null
	talkAvailable: boolean
	call: CallState | null
	links: { chat: string | null, call: string | null } | null
	url: string
	count: number | null
	managers?: { uid: string, displayName: string }[]
	removals?: { uid: string, displayName: string, until: number }[]
	unmanaged?: boolean
}

export interface Emote {
	id: string
	startedAt: number
	endsAt: number
}

export interface Participant {
	uid: string
	name: string
	appearance: Appearance
	mode: string
	trajectory: Trajectory
	emote: Emote | null
	generation: number
	enteredAt: number
	/** The person's "Today" note. */
	note: string | null
	/** Birthday today, when they share their birth date. */
	birthday: boolean
}

/** A shared focus session in the office. */
export interface FocusState {
	startedAt: number
	endsAt: number
	minutes: number
	uids: string[]
}

/** Nextcloud user status as others already see it; missing for invisible or offline people. */
export interface UserStatusInfo {
	status: 'online' | 'away' | 'dnd' | 'busy'
	message: string | null
	icon: string | null
	clearAt: number | null
}

export interface DeskOwner {
	deskId: string
	uid: string
	name: string
	note: string | null
	birthday: boolean
}

/** A resource shared with the office's Team, as the Team page lists it. */
export interface TeamResource {
	provider: string
	id: string
	label: string
	url: string
	iconUrl: string | null
	iconSvg: string | null
	iconEmoji: string | null
}

/** A Team resource with a short live badge, such as the number of Deck cards due. */
export interface ResourceView extends TeamResource {
	badge: string | null
}

export interface DeskList {
	desks: DeskOwner[]
	statuses: Record<string, UserStatusInfo>
}

export interface PropState {
	id: string
	startedAt: number
	endsAt: number
}

export interface Snapshot {
	office: string
	rev: number
	serverTime: number
	configRev: number
	title: string
	layoutId: string
	catalogHash: string
	capacity: number
	decor: Record<string, string>
	participants: Participant[]
	props: PropState[]
	call: CallState | null
	desksRev: number
	focus: FocusState | null
	you?: { session: string, generation: number }
}

export type RoomEvent
	= | { kind: 'upsert', participant: Participant }
		| { kind: 'remove', uid: string, reason: string }
		| { kind: 'prop', prop: PropState, uid: string }
		| { kind: 'config', configRev: number, decor: Record<string, string>, title: string }
		| { kind: 'call', call: CallState | null }
		| { kind: 'desks', desksRev: number }
		| { kind: 'focus', focus: FocusState | null }
		| { kind: 'closed' }

export interface EventBatch {
	office: string
	rev: number
	serverTime: number
	events: RoomEvent[]
}

export interface Preferences {
	appearance: Appearance
	ui: { view: 'scene' | 'list', reducedEffects: boolean, announcements: boolean }
}

export interface InitialConfig {
	view: 'directory' | 'office' | 'conversation'
	token: string | null
	conversation: string | null
	talk: boolean
	uid: string | null
	isAdmin: boolean
	clientPush: boolean
	catalogHash: string
	roomCapacity: number
	instanceOffices: boolean
}
