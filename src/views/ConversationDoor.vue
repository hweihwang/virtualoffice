<!--
  - SPDX-FileCopyrightText: 2026 Hoang Pham
  - SPDX-License-Identifier: AGPL-3.0-or-later
-->
<script setup lang="ts">
import type { InitialConfig, OfficeDefinition } from '../types.ts'

import { mdiOfficeBuilding } from '@mdi/js'
import axios from '@nextcloud/axios'
import { t } from '@nextcloud/l10n'
import { generateOcsUrl, generateUrl } from '@nextcloud/router'
import { onMounted, ref } from 'vue'
import NcButton from '@nextcloud/vue/components/NcButton'
import NcCheckboxRadioSwitch from '@nextcloud/vue/components/NcCheckboxRadioSwitch'
import NcEmptyContent from '@nextcloud/vue/components/NcEmptyContent'
import NcIconSvgWrapper from '@nextcloud/vue/components/NcIconSvgWrapper'
import NcLoadingIcon from '@nextcloud/vue/components/NcLoadingIcon'
import { api, ApiError } from '../api.ts'
import { errorMessage } from '../labels.ts'
import { pinMessage, postMessage } from '../talk.ts'

const props = defineProps<{ config: InitialConfig }>()
const conversation = props.config.conversation ?? ''

const office = ref<OfficeDefinition | null>(null)
const error = ref('')
const isModerator = ref(false)
const share = ref(true)
const pin = ref(true)
const sharing = ref(false)

/** Talk participant types: 1 owner, 2 moderator. */
async function loadRole() {
	try {
		const room = (await axios.get(generateOcsUrl('/apps/spreed/api/v4/room/{token}', { token: conversation }))).data.ocs.data
		isModerator.value = room.participantType === 1 || room.participantType === 2
	} catch {
		isModerator.value = false
	}
}

/** Posts the office link to the conversation and pins it, as the person who created the office. */
async function shareAndOpen() {
	if (!office.value) {
		return
	}
	sharing.value = true
	if (share.value) {
		try {
			const message = t('virtualoffice', 'This conversation now has an office. Step in: {url}', { url: office.value.url })
			const id = await postMessage(conversation, message)
			if (pin.value && isModerator.value && id !== null) {
				await pinMessage(conversation, id)
			}
		} catch {
			// Sharing is optional; the office exists either way.
		}
	}
	window.location.replace(office.value.url)
}

onMounted(async () => {
	try {
		const result = await api.conversationOffice(conversation)
		office.value = result.office
		if (!result.created) {
			window.location.replace(result.office.url)
			return
		}
		await loadRole()
	} catch (e) {
		error.value = e instanceof ApiError ? e.code : 'UNKNOWN'
	}
})
</script>

<template>
	<main class="door">
		<NcEmptyContent
			v-if="error"
			:name="error === 'CONVERSATION_NOT_SUPPORTED' ? t('virtualoffice', 'Offices are for group conversations') : t('virtualoffice', 'No office for this conversation')"
			:description="error === 'CONVERSATION_NOT_SUPPORTED'
				? t('virtualoffice', 'One-to-one conversations do not get an office. Start a call instead.')
				: errorMessage(error)">
			<template #icon>
				<NcIconSvgWrapper :path="mdiOfficeBuilding" />
			</template>
			<template #action>
				<NcButton :href="generateUrl('/call/{token}', { token: conversation })">
					{{ t('virtualoffice', 'Back to the conversation') }}
				</NcButton>
			</template>
		</NcEmptyContent>

		<NcEmptyContent
			v-else-if="office"
			:name="t('virtualoffice', '{name} now has an office', { name: office.title })"
			:description="t('virtualoffice', 'Everyone in the conversation can enter. The office keeps the conversation name and closes when the conversation is deleted.')">
			<template #icon>
				<NcIconSvgWrapper :path="mdiOfficeBuilding" />
			</template>
			<template #action>
				<div class="door__options">
					<NcCheckboxRadioSwitch v-model="share">
						{{ t('virtualoffice', 'Post the office in the conversation') }}
					</NcCheckboxRadioSwitch>
					<NcCheckboxRadioSwitch v-if="isModerator" v-model="pin" :disabled="!share">
						{{ t('virtualoffice', 'Pin it at the top of the chat') }}
					</NcCheckboxRadioSwitch>
					<NcButton variant="primary" :disabled="sharing" @click="shareAndOpen">
						{{ t('virtualoffice', 'Open office') }}
					</NcButton>
				</div>
			</template>
		</NcEmptyContent>

		<NcLoadingIcon
			v-else
			:size="44"
			:name="t('virtualoffice', 'Opening the office')"
			class="door__loading" />
	</main>
</template>

<style scoped>
.door {
	padding: 40px 16px;
}

.door__loading {
	margin-top: 80px;
}

.door__options {
	display: flex;
	flex-direction: column;
	align-items: flex-start;
	gap: 8px;
}
</style>
