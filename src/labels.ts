/**
 * SPDX-FileCopyrightText: 2026 Hoang Pham
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
import { t } from '@nextcloud/l10n'

export function zoneLabel(id: string | null): string {
	return ({
		entrance: t('virtualoffice', 'Entrance'),
		coffee: t('virtualoffice', 'Coffee corner'),
		common: t('virtualoffice', 'Common room'),
		focus: t('virtualoffice', 'Focus desks'),
	} as Record<string, string>)[id ?? ''] ?? t('virtualoffice', 'Walking')
}

export const zoneLabels = (): Record<string, string> => Object.fromEntries(['entrance', 'coffee', 'common', 'focus'].map((id) => [id, zoneLabel(id)]))

export function modeLabel(mode: string): string {
	return ({
		available: t('virtualoffice', 'Open to chat'),
		focus: t('virtualoffice', 'Focusing'),
		away: t('virtualoffice', 'Stepped away'),
	} as Record<string, string>)[mode] ?? mode
}

/** Nextcloud user status, as in the status menu. */
export function statusLabel(status: string): string {
	return ({
		online: t('virtualoffice', 'Online'),
		away: t('virtualoffice', 'Away'),
		dnd: t('virtualoffice', 'Do not disturb'),
		busy: t('virtualoffice', 'Busy'),
	} as Record<string, string>)[status] ?? status
}

/** What the person you knocked on answered. */
export function knockAnswerLabel(answer: string, name: string): string {
	return ({
		now: t('virtualoffice', '{name} can talk now', { name }),
		soon: t('virtualoffice', '{name} can talk in 10 minutes', { name }),
	} as Record<string, string>)[answer] ?? t('virtualoffice', '{name} will get back to you later', { name })
}

/** "Desk 3" for desk d3. */
export function deskLabel(deskId: string): string {
	return t('virtualoffice', 'Desk {number}', { number: deskId.replace(/^d/, '') })
}

export function emoteLabel(id: string): string {
	return ({
		wave: t('virtualoffice', 'Wave'),
		heart: t('virtualoffice', 'Heart'),
		laugh: t('virtualoffice', 'Laugh'),
		celebrate: t('virtualoffice', 'Celebrate'),
	} as Record<string, string>)[id] ?? id
}

/** What two people did when they reacted together. */
export function pairLabel(emote: string, a: string, b: string): string {
	return ({
		wave: t('virtualoffice', '{a} and {b} high-fived', { a, b }),
		heart: t('virtualoffice', '{a} and {b} shared a heart', { a, b }),
		laugh: t('virtualoffice', '{a} and {b} laughed together', { a, b }),
		celebrate: t('virtualoffice', '{a} and {b} celebrated together', { a, b }),
	} as Record<string, string>)[emote] ?? t('virtualoffice', '{a} and {b} reacted together', { a, b })
}

export function creatureLabel(id: string): string {
	return ({
		rabbit: t('virtualoffice', 'Rabbit'),
		cat: t('virtualoffice', 'Cat'),
		bear: t('virtualoffice', 'Bear'),
		bird: t('virtualoffice', 'Bird'),
	} as Record<string, string>)[id] ?? id
}

export function paletteLabel(id: string): string {
	return ({
		sage: t('virtualoffice', 'Sage'),
		peach: t('virtualoffice', 'Peach'),
		sky: t('virtualoffice', 'Sky'),
		lilac: t('virtualoffice', 'Lilac'),
		butter: t('virtualoffice', 'Butter'),
		rose: t('virtualoffice', 'Rose'),
		cocoa: t('virtualoffice', 'Cocoa'),
		slate: t('virtualoffice', 'Slate'),
	} as Record<string, string>)[id] ?? id
}

export function accessoryLabel(id: string): string {
	return ({
		none: t('virtualoffice', 'Nothing'),
		scarf: t('virtualoffice', 'Scarf'),
		glasses: t('virtualoffice', 'Glasses'),
		flower: t('virtualoffice', 'Flower'),
		beanie: t('virtualoffice', 'Beanie'),
	} as Record<string, string>)[id] ?? id
}

/** A layout with how many people and desks it holds. */
export function layoutLabel(id: string): string {
	return ({
		'starter-office-v1': t('virtualoffice', 'Large · up to 32 people, 12 desks'),
		'compact-office-v1': t('virtualoffice', 'Small · up to 12 people, 6 desks'),
	} as Record<string, string>)[id] ?? id
}

export function decorLabel(slot: string, value?: string): string {
	if (value === undefined) {
		return ({
			floor: t('virtualoffice', 'Floor'),
			rug: t('virtualoffice', 'Rug'),
			wallArt: t('virtualoffice', 'Wall art'),
			lights: t('virtualoffice', 'Lights'),
			season: t('virtualoffice', 'Season'),
		} as Record<string, string>)[slot] ?? slot
	}
	return ({
		oak: t('virtualoffice', 'Oak'),
		mint: t('virtualoffice', 'Mint'),
		lavender: t('virtualoffice', 'Lavender'),
		slate: t('virtualoffice', 'Slate'),
		sunrise: t('virtualoffice', 'Sunrise'),
		ocean: t('virtualoffice', 'Ocean'),
		meadow: t('virtualoffice', 'Meadow'),
		none: t('virtualoffice', 'None'),
		mountains: t('virtualoffice', 'Mountains'),
		cat: t('virtualoffice', 'Cat poster'),
		abstract: t('virtualoffice', 'Shapes'),
		warm: t('virtualoffice', 'String lights'),
		autumn: t('virtualoffice', 'Autumn'),
		winter: t('virtualoffice', 'Winter'),
		lunar: t('virtualoffice', 'Lunar New Year'),
	} as Record<string, string>)[value] ?? value
}

export function propLabel(id: string): string {
	return ({
		coffee: t('virtualoffice', 'Make coffee'),
		plant: t('virtualoffice', 'Water the plant'),
	} as Record<string, string>)[id] ?? id
}

/**
 * User-facing text for API error codes.
 */
export function errorMessage(code: string): string {
	return ({
		OFFICE_UNAVAILABLE: t('virtualoffice', 'This office is not available. It may have been deleted, or you do not have access to it.'),
		ACTION_DENIED: t('virtualoffice', 'You are not allowed to do that.'),
		REVISION_MISMATCH: t('virtualoffice', 'Someone else changed this office. The latest version was loaded.'),
		RATE_LIMITED: t('virtualoffice', 'Slow down a little and try again.'),
		OUT_OF_REACH: t('virtualoffice', 'Walk a bit closer first.'),
		AUDIENCE_UNAVAILABLE: t('virtualoffice', 'Access to this office cannot be checked because Teams or Talk is not available right now. Try again later.'),
		LAST_MANAGER: t('virtualoffice', 'Add another manager first.'),
		INVALID_INPUT: t('virtualoffice', 'Some fields are not valid. Check them and try again.'),
		NETWORK: t('virtualoffice', 'The server cannot be reached. Check your connection and try again.'),
		DESK_TAKEN: t('virtualoffice', 'Someone else just took that desk.'),
		KNOCK_PENDING: t('virtualoffice', 'You already knocked. Wait for the answer.'),
		KNOCK_GONE: t('virtualoffice', 'This knock was already answered or is too old.'),
		PERSON_UNAVAILABLE: t('virtualoffice', 'You cannot knock on or call this person right now.'),
	} as Record<string, string>)[code] ?? t('virtualoffice', 'Something went wrong. Try again.')
}
