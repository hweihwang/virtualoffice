<!--
  - SPDX-FileCopyrightText: 2026 Hoang Pham
  - SPDX-License-Identifier: AGPL-3.0-or-later
-->
<script setup lang="ts">
import type { InitialConfig, OfficeDefinition } from '../types.ts'

import { mdiAccountGroup, mdiPlus } from '@mdi/js'
import { n, t } from '@nextcloud/l10n'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import NcButton from '@nextcloud/vue/components/NcButton'
import NcEmptyContent from '@nextcloud/vue/components/NcEmptyContent'
import NcIconSvgWrapper from '@nextcloud/vue/components/NcIconSvgWrapper'
import NcLoadingIcon from '@nextcloud/vue/components/NcLoadingIcon'
import NcNoteCard from '@nextcloud/vue/components/NcNoteCard'
import NcTextField from '@nextcloud/vue/components/NcTextField'
import CreateOfficeDialog from '../components/CreateOfficeDialog.vue'
import CreaturePreview from '../components/CreaturePreview.vue'
import { catalog } from '../../shared/catalog.ts'
import { api, ApiError } from '../api.ts'
import { errorMessage } from '../labels.ts'
import { conversationTokens } from '../talk.ts'

const props = defineProps<{ config: InitialConfig }>()

const offices = ref<OfficeDefinition[]>([])
const loading = ref(true)
const error = ref('')
const search = ref('')
const creating = ref(false)
let refreshTimer: ReturnType<typeof setInterval> | null = null
let searchTimer: ReturnType<typeof setTimeout> | null = null

function sample(index: number) {
	return {
		creature: catalog.creatures[index % catalog.creatures.length],
		palette: catalog.palettes[(index * 3) % catalog.palettes.length].id,
		accessory: 'none',
	}
}

const sorted = computed(() => [...offices.value].sort((a, b) => (b.count ?? 0) - (a.count ?? 0) || a.title.localeCompare(b.title)))

const PAGE = 50
/** The user's conversations from Talk, fetched once, so no conversation office is missed. */
let conversations: Promise<string[] | null> | null = null
const myConversations = () => (conversations ??= props.config.talk ? conversationTokens() : Promise.resolve(null))
const hasMore = ref(false)
const loadingMore = ref(false)

async function load() {
	try {
		const page = await api.listOffices(search.value, 0, await myConversations())
		offices.value = page
		hasMore.value = page.length === PAGE
		error.value = ''
	} catch (e) {
		error.value = errorMessage(e instanceof ApiError ? e.code : 'UNKNOWN')
	} finally {
		loading.value = false
	}
}

async function loadMore() {
	loadingMore.value = true
	try {
		const page = await api.listOffices(search.value, offices.value.length, await myConversations())
		const known = new Set(offices.value.map((o) => o.token))
		offices.value = [...offices.value, ...page.filter((o) => !known.has(o.token))]
		hasMore.value = page.length === PAGE
	} catch (e) {
		error.value = errorMessage(e instanceof ApiError ? e.code : 'UNKNOWN')
	} finally {
		loadingMore.value = false
	}
}

/** People counts only; refreshed while the page is visible. */
async function refreshCounts() {
	if (document.hidden || offices.value.length === 0) {
		return
	}
	// The API takes up to 50 offices per request; a failed batch only loses its own counts.
	const tokens = offices.value.map((o) => o.token)
	const batches = await Promise.all(Array.from({ length: Math.ceil(tokens.length / 50) }, (_, i) => api.summaries(tokens.slice(i * 50, i * 50 + 50)).catch(() => [])))
	const byToken = new Map(batches.flat().map((c) => [c.token, c.count]))
	offices.value = offices.value.map((o) => ({ ...o, count: byToken.get(o.token) ?? null }))
}

watch(search, () => {
	if (searchTimer) {
		clearTimeout(searchTimer)
	}
	searchTimer = setTimeout(load, 250)
})

function created(office: OfficeDefinition) {
	creating.value = false
	window.location.href = office.url
}

onMounted(() => {
	load()
	refreshTimer = setInterval(refreshCounts, 30000)
})
onBeforeUnmount(() => {
	if (refreshTimer) {
		clearInterval(refreshTimer)
	}
})
</script>

<template>
	<main class="directory">
		<header class="directory__header">
			<div>
				<h2>{{ t('virtualoffice', 'Offices') }}</h2>
				<p class="directory__lead">
					{{ t('virtualoffice', 'Drop in to see who is around, say hello and hop into a chat.') }}
				</p>
			</div>
			<NcButton variant="primary" @click="creating = true">
				<template #icon>
					<NcIconSvgWrapper :path="mdiPlus" />
				</template>
				{{ t('virtualoffice', 'New office') }}
			</NcButton>
		</header>

		<NcTextField
			v-model="search"
			class="directory__search"
			:label="t('virtualoffice', 'Search offices')"
			type="search" />

		<NcNoteCard v-if="error" type="error" :text="error" />

		<NcLoadingIcon
			v-if="loading"
			:size="44"
			:name="t('virtualoffice', 'Loading offices')"
			class="directory__loading" />

		<NcEmptyContent
			v-else-if="offices.length === 0"
			:name="search ? t('virtualoffice', 'No matching offices') : t('virtualoffice', 'No offices yet')"
			:description="t('virtualoffice', 'Create an office for one of your Teams, groups or Talk conversations. Everyone in it can drop in.')">
			<template #icon>
				<NcIconSvgWrapper :path="mdiAccountGroup" />
			</template>
			<template #action>
				<NcButton v-if="!search" variant="primary" @click="creating = true">
					{{ t('virtualoffice', 'Create the first office') }}
				</NcButton>
			</template>
		</NcEmptyContent>

		<ul v-else class="directory__grid">
			<li v-for="(office, index) in sorted" :key="office.token">
				<a class="office-card" :href="office.url">
					<span class="office-card__art" aria-hidden="true">
						<CreaturePreview :appearance="sample(index)" :size="44" />
						<CreaturePreview :appearance="sample(index + 1)" :size="36" facing="east" />
					</span>
					<span class="office-card__text">
						<span class="office-card__title">{{ office.title }}</span>
						<span class="office-card__audience">
							<template v-if="office.audience.kind === 'talk'">{{ t('virtualoffice', 'Talk conversation {name}', { name: office.audience.label }) }}</template>
							<template v-else>{{ office.audience.label }}</template>
						</span>
						<span v-if="office.call?.known && office.call.active" class="office-card__call">{{ t('virtualoffice', 'Call in progress') }}</span>
						<span class="office-card__count" :class="{ 'office-card__count--busy': (office.count ?? 0) > 0 }">
							<template v-if="office.count === null">{{ t('virtualoffice', 'Could not load who is here') }}</template>
							<template v-else-if="office.count === 0">{{ t('virtualoffice', 'Nobody here right now') }}</template>
							<template v-else>{{ n('virtualoffice', '%n person here', '%n people here', office.count) }}</template>
						</span>
					</span>
				</a>
			</li>
		</ul>
		<NcButton
			v-if="hasMore && !loading"
			class="directory__more"
			:disabled="loadingMore"
			@click="loadMore">
			{{ t('virtualoffice', 'Show more offices') }}
		</NcButton>

		<CreateOfficeDialog
			v-if="creating"
			:isAdmin="config.isAdmin"
			:talk="config.talk"
			@close="creating = false"
			@created="created" />
	</main>
</template>

<style scoped>
.directory {
	max-width: 1100px;
	margin: 0 auto;
	padding: calc(var(--default-grid-baseline) * 6) calc(var(--default-grid-baseline) * 4);
	padding-inline-start: max(calc(var(--default-grid-baseline) * 4), var(--app-navigation-padding, 0px));
}

.directory__header {
	display: flex;
	flex-wrap: wrap;
	align-items: flex-start;
	justify-content: space-between;
	gap: 16px;
	margin-bottom: 16px;
}

.directory__header h2 {
	margin: 0;
}

.directory__lead {
	color: var(--color-text-maxcontrast);
}

.directory__search {
	max-width: 420px;
	margin-bottom: 20px;
}

.directory__more {
	margin: 20px auto 0;
}

.directory__loading {
	margin-top: 60px;
}

.directory__grid {
	display: grid;
	grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
	gap: 16px;
}

.office-card {
	display: flex;
	align-items: center;
	gap: 16px;
	min-height: 96px;
	padding: 16px;
	border-radius: var(--border-radius-container-large, 16px);
	background: var(--color-background-hover);
	color: var(--color-main-text);
	text-decoration: none;
	transition: background-color .15s;
}

.office-card:hover, .office-card:focus-visible {
	background: var(--color-primary-element-light);
}

.office-card:focus-visible {
	outline: 2px solid var(--color-primary-element);
}

.office-card__art {
	display: flex;
	align-items: flex-end;
	padding: 6px 8px 2px;
	border-radius: 14px;
	background: var(--color-primary-element-light);
}

.office-card__text {
	display: flex;
	flex-direction: column;
	min-width: 0;
	gap: 2px;
}

.office-card__title {
	overflow: hidden;
	font-weight: 700;
	font-size: 1.1em;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.office-card__audience, .office-card__count {
	color: var(--color-text-maxcontrast);
}

.office-card__call {
	color: var(--color-success-text);
	font-weight: 600;
}

.office-card__count--busy {
	color: var(--color-success-text);
	font-weight: 600;
}
</style>
