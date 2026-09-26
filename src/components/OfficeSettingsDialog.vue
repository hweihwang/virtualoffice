<!--
  - SPDX-FileCopyrightText: 2026 Hoang Pham
  - SPDX-License-Identifier: AGPL-3.0-or-later
-->
<script setup lang="ts">
import type { OfficeDefinition } from '../types.ts'

import { getCanonicalLocale, t } from '@nextcloud/l10n'
import { computed, onMounted, ref } from 'vue'
import NcButton from '@nextcloud/vue/components/NcButton'
import NcCheckboxRadioSwitch from '@nextcloud/vue/components/NcCheckboxRadioSwitch'
import NcDialog from '@nextcloud/vue/components/NcDialog'
import NcNoteCard from '@nextcloud/vue/components/NcNoteCard'
import NcSelect from '@nextcloud/vue/components/NcSelect'
import NcTextField from '@nextcloud/vue/components/NcTextField'
import { catalog } from '../../shared/catalog.ts'
import { api, ApiError } from '../api.ts'
import { decorLabel, errorMessage } from '../labels.ts'

const props = defineProps<{ office: OfficeDefinition }>()
const emit = defineEmits<{ close: [], updated: [office: OfficeDefinition], deleted: [] }>()

const current = ref<OfficeDefinition>(props.office)
const title = ref(props.office.title)
const decor = ref<Record<string, string>>({ ...props.office.config.decor })
const talkSource = ref<'none' | 'team' | 'link' | 'conversation'>(props.office.config.talk?.source ?? 'none')
const teamConversations = ref<{ token: string, label: string }[]>([])
const teamConversation = ref<{ token: string, label: string } | null>(null)
const linkUrl = ref(props.office.config.talk?.source === 'link' ? props.office.config.talk.token ?? '' : '')
const linkLabel = ref(props.office.config.talk?.source === 'link' ? props.office.config.talk.label : '')
const managerOptions = ref<{ uid: string, displayName: string }[]>([])
const newManager = ref<{ uid: string, displayName: string } | null>(null)
const error = ref('')
const saving = ref(false)
const confirmDelete = ref(false)

const isTeam = computed(() => current.value.audience.kind === 'team')
const isConversation = computed(() => current.value.audience.kind === 'talk')

function handle(e: unknown) {
	if (e instanceof ApiError && e.code === 'REVISION_MISMATCH') {
		void reload()
	}
	error.value = e instanceof ApiError && e.code === 'INVALID_INPUT' ? e.message : errorMessage(e instanceof ApiError ? e.code : 'UNKNOWN')
}

async function reload() {
	current.value = await api.getOffice(current.value.token)
	emit('updated', current.value)
}

async function save() {
	saving.value = true
	error.value = ''
	let talk: Record<string, string> | null = null
	if (talkSource.value === 'team' && teamConversation.value) {
		talk = { source: 'team', token: teamConversation.value.token }
	} else if (talkSource.value === 'link') {
		talk = { source: 'link', url: linkUrl.value, label: linkLabel.value }
	}
	try {
		current.value = await api.updateOffice(current.value.token, current.value.revision, isConversation.value
			? { decor: decor.value }
			: { title: title.value, decor: decor.value, talk })
		emit('updated', current.value)
		emit('close')
	} catch (e) {
		handle(e)
	} finally {
		saving.value = false
	}
}

async function searchPeople(query: string) {
	if (query.trim() === '') {
		return
	}
	try {
		managerOptions.value = await api.people(current.value.token, query)
	} catch (e) {
		handle(e)
	}
}

async function addManager() {
	if (!newManager.value) {
		return
	}
	try {
		current.value = await api.addManager(current.value.token, newManager.value.uid)
		newManager.value = null
		emit('updated', current.value)
	} catch (e) {
		handle(e)
	}
}

async function removeManager(uid: string) {
	try {
		current.value = await api.removeManager(current.value.token, uid)
		emit('updated', current.value)
	} catch (e) {
		handle(e)
	}
}

async function lift(uid: string) {
	try {
		current.value = await api.liftRemoval(current.value.token, uid)
		emit('updated', current.value)
	} catch (e) {
		handle(e)
	}
}

async function destroy() {
	try {
		await api.deleteOffice(current.value.token, current.value.revision)
		emit('deleted')
	} catch (e) {
		handle(e)
	}
}

const untilText = (until: number) => new Date(until).toLocaleTimeString(getCanonicalLocale(), { hour: 'numeric', minute: '2-digit' })

onMounted(async () => {
	if (isTeam.value) {
		try {
			teamConversations.value = await api.talkConversations(current.value.token)
			const talk = current.value.config.talk
			if (talk?.source === 'team') {
				teamConversation.value = teamConversations.value.find((c) => c.token === talk.token) ?? null
			}
		} catch {
			teamConversations.value = []
		}
	}
})
</script>

<template>
	<NcDialog
		:name="t('virtualoffice', 'Office settings')"
		:open="true"
		size="normal"
		@update:open="(open) => !open && emit('close')">
		<form class="settings" @submit.prevent="save">
			<NcNoteCard v-if="isConversation" type="info" :text="t('virtualoffice', 'This office belongs to the Talk conversation {name}. Its name and chat follow the conversation, and everyone in the conversation can enter.', { name: current.audience.label })" />
			<NcTextField
				v-else
				v-model="title"
				:label="t('virtualoffice', 'Office name')"
				:maxlength="120" />

			<fieldset>
				<legend>{{ t('virtualoffice', 'Decor') }}</legend>
				<div class="settings__decor">
					<label v-for="(slot, name) in catalog.decor" :key="name">
						<span>{{ decorLabel(name) }}</span>
						<select v-model="decor[name]">
							<option v-for="option in slot.options" :key="option" :value="option">{{ decorLabel(name, option) }}</option>
						</select>
					</label>
				</div>
			</fieldset>

			<fieldset v-if="!isConversation">
				<legend>{{ t('virtualoffice', 'Talk conversation') }}</legend>
				<p class="settings__hint">
					{{ t('virtualoffice', 'People open this conversation from the office. Talk still decides who can read it.') }}
				</p>
				<NcCheckboxRadioSwitch
					v-model="talkSource"
					type="radio"
					value="none"
					name="talk">
					{{ t('virtualoffice', 'No conversation') }}
				</NcCheckboxRadioSwitch>
				<NcCheckboxRadioSwitch
					v-if="isTeam"
					v-model="talkSource"
					type="radio"
					value="team"
					name="talk">
					{{ t('virtualoffice', 'A conversation shared with the Team') }}
				</NcCheckboxRadioSwitch>
				<NcSelect
					v-if="talkSource === 'team'"
					v-model="teamConversation"
					:options="teamConversations"
					label="label"
					:inputLabel="t('virtualoffice', 'Conversation')">
					<template #no-options>
						{{ t('virtualoffice', 'No conversation is shared with this Team yet. Add the Team to a conversation in Talk first.') }}
					</template>
				</NcSelect>
				<NcCheckboxRadioSwitch
					v-model="talkSource"
					type="radio"
					value="link"
					name="talk">
					{{ t('virtualoffice', 'A conversation link') }}
				</NcCheckboxRadioSwitch>
				<template v-if="talkSource === 'link'">
					<NcTextField v-model="linkUrl" :label="t('virtualoffice', 'Conversation link from this Nextcloud')" />
					<NcTextField v-model="linkLabel" :label="t('virtualoffice', 'Name shown in the office')" :maxlength="60" />
				</template>
			</fieldset>

			<NcNoteCard v-if="error" type="error" :text="error" />

			<div class="settings__actions">
				<NcButton @click="emit('close')">
					{{ t('virtualoffice', 'Cancel') }}
				</NcButton>
				<NcButton variant="primary" type="submit" :disabled="saving">
					{{ t('virtualoffice', 'Save') }}
				</NcButton>
			</div>
		</form>

		<section class="settings__section">
			<h3>{{ t('virtualoffice', 'Managers') }}</h3>
			<ul>
				<li v-for="manager in current.managers ?? []" :key="manager.uid" class="settings__row">
					<span>{{ manager.displayName }}</span>
					<NcButton variant="tertiary" size="small" @click="removeManager(manager.uid)">
						{{ t('virtualoffice', 'Remove') }}
					</NcButton>
				</li>
			</ul>
			<div class="settings__add">
				<NcSelect
					v-model="newManager"
					:options="managerOptions"
					label="displayName"
					:filterable="false"
					:inputLabel="t('virtualoffice', 'Add a manager')"
					@search="searchPeople" />
				<NcButton :disabled="!newManager" @click="addManager">
					{{ t('virtualoffice', 'Add') }}
				</NcButton>
			</div>
		</section>

		<section v-if="(current.removals ?? []).length" class="settings__section">
			<h3>{{ t('virtualoffice', 'Temporarily removed') }}</h3>
			<ul>
				<li v-for="removal in current.removals" :key="removal.uid" class="settings__row">
					<span>{{ t('virtualoffice', '{name} until {time}', { name: removal.displayName, time: untilText(removal.until) }) }}</span>
					<NcButton variant="tertiary" size="small" @click="lift(removal.uid)">
						{{ t('virtualoffice', 'Let back in') }}
					</NcButton>
				</li>
			</ul>
		</section>

		<section class="settings__section">
			<h3>{{ t('virtualoffice', 'Delete office') }}</h3>
			<p class="settings__hint">
				{{ t('virtualoffice', 'Everyone inside has to leave, and the office cannot be restored.') }}
			</p>
			<NcButton v-if="!confirmDelete" variant="error" @click="confirmDelete = true">
				{{ t('virtualoffice', 'Delete office') }}
			</NcButton>
			<div v-else class="settings__add">
				<NcButton @click="confirmDelete = false">
					{{ t('virtualoffice', 'Keep office') }}
				</NcButton>
				<NcButton variant="error" @click="destroy">
					{{ t('virtualoffice', 'Yes, delete it') }}
				</NcButton>
			</div>
		</section>
	</NcDialog>
</template>

<style scoped>
.settings {
	display: flex;
	flex-direction: column;
	gap: 12px;
}

fieldset legend, .settings__section h3 {
	margin: 8px 0 4px;
	font-size: 1em;
	font-weight: 700;
}

.settings__decor {
	display: grid;
	grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
	gap: 8px;
}

.settings__decor label {
	display: flex;
	flex-direction: column;
	gap: 2px;
}

.settings__decor select {
	width: 100%;
	min-height: 44px;
}

.settings__hint {
	color: var(--color-text-maxcontrast);
}

.settings__actions, .settings__add {
	display: flex;
	align-items: flex-end;
	justify-content: flex-end;
	gap: 8px;
}

.settings__add > :first-child {
	flex: 1;
}

.settings__section {
	margin-top: 16px;
	padding-top: 8px;
	border-top: 1px solid var(--color-border);
}

.settings__row {
	display: flex;
	align-items: center;
	justify-content: space-between;
	min-height: 44px;
}
</style>
