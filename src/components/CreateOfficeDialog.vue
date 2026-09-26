<!--
  - SPDX-FileCopyrightText: 2026 Hoang Pham
  - SPDX-License-Identifier: AGPL-3.0-or-later
-->
<script setup lang="ts">
import type { Audience, OfficeDefinition } from '../types.ts'

import axios from '@nextcloud/axios'
import { t } from '@nextcloud/l10n'
import { generateOcsUrl } from '@nextcloud/router'
import { computed, onMounted, ref } from 'vue'
import NcButton from '@nextcloud/vue/components/NcButton'
import NcDialog from '@nextcloud/vue/components/NcDialog'
import NcNoteCard from '@nextcloud/vue/components/NcNoteCard'
import NcSelect from '@nextcloud/vue/components/NcSelect'
import NcTextField from '@nextcloud/vue/components/NcTextField'
import { api, ApiError } from '../api.ts'
import { errorMessage } from '../labels.ts'

const props = defineProps<{ isAdmin: boolean, talk?: boolean }>()
const emit = defineEmits<{ close: [], created: [office: OfficeDefinition] }>()

const title = ref('')
const audiences = ref<Audience[]>([])
const audience = ref<Audience | null>(null)
const manager = ref<{ id: string, label: string } | null>(null)
const managerOptions = ref<{ id: string, label: string }[]>([])
const loadingAudiences = ref(false)
const saving = ref(false)
const error = ref('')

const needsManager = computed(() => audience.value !== null && audience.value.kind !== 'team' && audience.value.kind !== 'talk')
/** Conversation offices always carry the conversation's name. */
const isTalk = computed(() => audience.value?.kind === 'talk')
const canSave = computed(() => (isTalk.value || title.value.trim() !== '') && audience.value !== null && (!needsManager.value || manager.value !== null) && !saving.value)

/** Group and public Talk conversations the user is in, read from Talk's API. */
async function talkConversations(query: string): Promise<Audience[]> {
	if (!props.talk) {
		return []
	}
	try {
		const rooms = (await axios.get(generateOcsUrl('/apps/spreed/api/v4/room'))).data.ocs.data as { token: string, displayName: string, type: number }[]
		const search = query.trim().toLowerCase()
		return rooms
			.filter((room) => (room.type === 2 || room.type === 3) && (search === '' || room.displayName.toLowerCase().includes(search)))
			.map((room) => ({ kind: 'talk' as const, id: room.token, label: room.displayName }))
	} catch {
		return []
	}
}

async function searchAudiences(query = '') {
	loadingAudiences.value = true
	try {
		const [nextcloud, conversations] = await Promise.all([api.audiences(query), talkConversations(query)])
		audiences.value = [...nextcloud, ...conversations]
		if (audience.value === null && audiences.value.length === 1) {
			audience.value = audiences.value[0]
		}
	} catch (e) {
		error.value = errorMessage(e instanceof ApiError ? e.code : 'UNKNOWN')
	} finally {
		loadingAudiences.value = false
	}
}

/**
 * Account search from core, used by admins to pick the first manager of a group office.
 */
async function searchManagers(query: string) {
	if (query.trim() === '') {
		return
	}
	const response = await axios.get(generateOcsUrl('/core/autocomplete/get'), { params: { search: query, itemType: ' ', itemId: ' ', shareTypes: [0], limit: 10 } })
	managerOptions.value = response.data.ocs.data.map((entry: { id: string, label: string }) => ({ id: entry.id, label: entry.label }))
}

async function save() {
	if (!canSave.value || audience.value === null) {
		return
	}
	saving.value = true
	error.value = ''
	try {
		emit('created', await api.createOffice(isTalk.value ? audience.value.label : title.value.trim(), { kind: audience.value.kind, id: audience.value.id }, manager.value?.id))
	} catch (e) {
		error.value = e instanceof ApiError && e.code === 'INVALID_INPUT' ? e.message : errorMessage(e instanceof ApiError ? e.code : 'UNKNOWN')
	} finally {
		saving.value = false
	}
}

const kindLabel = (kind: string) => ({ team: t('virtualoffice', 'Team'), group: t('virtualoffice', 'Group'), instance: t('virtualoffice', 'Everyone'), talk: t('virtualoffice', 'Talk conversation') } as Record<string, string>)[kind] ?? kind

onMounted(() => searchAudiences())
</script>

<template>
	<NcDialog
		:name="t('virtualoffice', 'New office')"
		:open="true"
		size="normal"
		@update:open="(open) => !open && emit('close')">
		<form class="create" @submit.prevent="save">
			<NcTextField
				v-if="!isTalk"
				v-model="title"
				:label="t('virtualoffice', 'Office name')"
				:maxlength="120"
				required />
			<NcSelect
				v-model="audience"
				:options="audiences"
				:inputLabel="t('virtualoffice', 'Who is this office for?')"
				label="label"
				:loading="loadingAudiences"
				:clearable="false"
				:filterable="false"
				@search="searchAudiences">
				<template #option="option">
					<span class="create__option"><strong>{{ option.label }}</strong> <span>{{ kindLabel(option.kind) }}</span></span>
				</template>
				<template #no-options>
					{{ props.isAdmin ? t('virtualoffice', 'No Teams or groups found') : t('virtualoffice', 'You are not in any Team yet. Join or create a Team in Contacts first.') }}
				</template>
			</NcSelect>
			<p class="create__hint">
				{{ isTalk
					? t('virtualoffice', 'Everyone in the conversation can find and enter the office. It keeps the conversation\'s name and follows it when it is renamed.')
					: t('virtualoffice', 'Everyone with access can find and enter the office. You can change the name, decor and Talk link later, but not who it is for.') }}
			</p>
			<NcSelect
				v-if="needsManager"
				v-model="manager"
				:options="managerOptions"
				:inputLabel="t('virtualoffice', 'First manager')"
				label="label"
				:filterable="false"
				@search="searchManagers" />
			<NcNoteCard v-if="error" type="error" :text="error" />
			<div class="create__actions">
				<NcButton @click="emit('close')">
					{{ t('virtualoffice', 'Cancel') }}
				</NcButton>
				<NcButton variant="primary" type="submit" :disabled="!canSave">
					{{ saving ? t('virtualoffice', 'Creating…') : t('virtualoffice', 'Create office') }}
				</NcButton>
			</div>
		</form>
	</NcDialog>
</template>

<style scoped>
.create {
	display: flex;
	flex-direction: column;
	gap: 12px;
	padding-bottom: 8px;
}

.create__hint {
	color: var(--color-text-maxcontrast);
}

.create__option span {
	color: var(--color-text-maxcontrast);
}

.create__actions {
	display: flex;
	justify-content: flex-end;
	gap: 8px;
}
</style>
