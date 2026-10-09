<!--
  - SPDX-FileCopyrightText: 2026 Hoang Pham
  - SPDX-License-Identifier: AGPL-3.0-or-later
-->
<script setup lang="ts">
import type { AdminSettings } from '../api.ts'
import type { OfficeDefinition } from '../types.ts'

import { loadState } from '@nextcloud/initial-state'
import { n, t } from '@nextcloud/l10n'
import { onMounted, ref } from 'vue'
import NcButton from '@nextcloud/vue/components/NcButton'
import NcCheckboxRadioSwitch from '@nextcloud/vue/components/NcCheckboxRadioSwitch'
import NcNoteCard from '@nextcloud/vue/components/NcNoteCard'
import NcSettingsSection from '@nextcloud/vue/components/NcSettingsSection'
import NcTextField from '@nextcloud/vue/components/NcTextField'
import { api, ApiError } from '../api.ts'
import { errorMessage } from '../labels.ts'

const settings = ref(loadState<AdminSettings>('virtualoffice', 'admin'))
const capacity = ref(String(settings.value.roomCapacity))
const offices = ref<OfficeDefinition[]>([])
const hasMore = ref(false)
const PAGE = 50
const message = ref('')
const error = ref('')

async function save(change: Partial<AdminSettings>) {
	error.value = ''
	try {
		settings.value = await api.saveAdminSettings(change)
		capacity.value = String(settings.value.roomCapacity)
		message.value = t('virtualoffice', 'Saved')
		setTimeout(() => {
			message.value = ''
		}, 2000)
	} catch (e) {
		error.value = errorMessage(e instanceof ApiError ? e.code : 'UNKNOWN')
	}
}

async function loadOffices() {
	try {
		const page = await api.adminOffices(offices.value.length)
		offices.value = [...offices.value, ...page]
		hasMore.value = page.length === PAGE
	} catch (e) {
		error.value = errorMessage(e instanceof ApiError ? e.code : 'UNKNOWN')
	}
}

onMounted(loadOffices)
</script>

<template>
	<div>
		<NcSettingsSection
			:name="t('virtualoffice', 'Virtual Office')"
			:description="t('virtualoffice', 'Shared offices where people in a Team, group or Talk conversation see each other as characters.')">
			<NcNoteCard v-if="settings.clientPush" type="success" :text="t('virtualoffice', 'Movement is delivered instantly through Client Push.')" />
			<NcNoteCard v-else type="info" :text="t('virtualoffice', 'Offices work without Client Push, but browsers check for updates about once a second. Set up Client Push (notify_push) so movement appears instantly and busy offices put less load on the server.')" />

			<div class="admin__row">
				<NcTextField
					v-model="capacity"
					type="number"
					:label="t('virtualoffice', 'People per office (2–{max})', { max: settings.maxRoomCapacity })"
					:min="2"
					:max="settings.maxRoomCapacity" />
				<NcButton @click="save({ roomCapacity: Number(capacity) })">
					{{ t('virtualoffice', 'Save') }}
				</NcButton>
			</div>
			<p class="admin__hint">
				{{ t('virtualoffice', 'Lowering the limit does not take anyone out; it only stops new people from entering a full office.') }}
			</p>

			<NcCheckboxRadioSwitch :modelValue="settings.instanceOffices" type="switch" @update:modelValue="(value: boolean) => save({ instanceOffices: value })">
				{{ t('virtualoffice', 'Allow offices for everyone on this Nextcloud') }}
			</NcCheckboxRadioSwitch>
			<p class="admin__hint">
				{{ t('virtualoffice', 'Admins can then create offices that every account can enter. Team and group offices are always available.') }}
			</p>

			<NcCheckboxRadioSwitch :modelValue="settings.voice" type="switch" @update:modelValue="(value: boolean) => save({ voice: value })">
				{{ t('virtualoffice', 'Allow voice') }}
			</NcCheckboxRadioSwitch>
			<p class="admin__hint">
				{{ t('virtualoffice', 'People who turn on their microphone hear others standing close by, as in a game. Audio goes directly between browsers and is never recorded. Voice uses the STUN and TURN servers set up in Talk; company networks often need a TURN server. Voice needs HTTPS.') }}
			</p>

			<p v-if="message" role="status">
				{{ message }}
			</p>
			<NcNoteCard v-if="error" type="error" :text="error" />
		</NcSettingsSection>

		<NcSettingsSection
			:name="t('virtualoffice', 'All offices')"
			:description="t('virtualoffice', 'Offices where no manager has access anymore are marked. Open one to add a manager or delete it.')">
			<p v-if="offices.length === 0" class="admin__hint">
				{{ t('virtualoffice', 'No offices yet') }}
			</p>
			<ul v-else class="admin__offices">
				<li v-for="office in offices" :key="office.token">
					<a :href="office.url">{{ office.title }}</a>
					<span class="admin__hint">{{ office.audience.label }} · {{ n('virtualoffice', '%n inside', '%n inside', office.count ?? 0) }}</span>
					<strong v-if="office.unmanaged" class="admin__unmanaged">{{ t('virtualoffice', 'No manager') }}</strong>
				</li>
			</ul>
			<NcButton v-if="hasMore" @click="loadOffices">
				{{ t('virtualoffice', 'Show more') }}
			</NcButton>
		</NcSettingsSection>
	</div>
</template>

<style scoped>
.admin__row > :last-child {
	flex: none;
}

.admin__row {
	display: flex;
	align-items: flex-end;
	gap: 8px;
	max-width: 420px;
	margin-top: 12px;
}

.admin__hint {
	color: var(--color-text-maxcontrast);
}

.admin__offices li {
	display: flex;
	flex-wrap: wrap;
	gap: 8px;
	padding: 6px 0;
}

.admin__offices a {
	font-weight: 600;
}

.admin__unmanaged {
	color: var(--color-warning-text);
}
</style>
