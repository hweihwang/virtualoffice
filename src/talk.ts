/**
 * SPDX-FileCopyrightText: 2026 Hoang Pham
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
import axios from '@nextcloud/axios'
import { generateOcsUrl } from '@nextcloud/router'

/**
 * Posts a message to a Talk conversation as the current user. Talk shows the
 * first link in it as a card.
 *
 * @return the message id
 */
export async function postMessage(conversation: string, message: string): Promise<number | null> {
	const posted = (await axios.post(generateOcsUrl('/apps/spreed/api/v1/chat/{token}', { token: conversation }), { message })).data.ocs.data
	return posted?.id ?? null
}

export async function pinMessage(conversation: string, messageId: number): Promise<void> {
	await axios.post(generateOcsUrl('/apps/spreed/api/v1/chat/{token}/{messageId}/pin', { token: conversation, messageId }))
}

/**
 * Tokens of the user's group and public conversations, or null without Talk.
 * Talk has no server API for this list, so the directory sends it along.
 */
export async function conversationTokens(): Promise<string[] | null> {
	try {
		const rooms = (await axios.get(generateOcsUrl('/apps/spreed/api/v4/room'), { params: { noStatusUpdate: 1, includeStatus: 0 } })).data.ocs.data as { token: string, type: number }[]
		return rooms.filter((room) => room.type === 2 || room.type === 3).map((room) => room.token)
	} catch {
		return null
	}
}
