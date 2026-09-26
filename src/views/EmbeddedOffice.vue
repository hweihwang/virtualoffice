<!--
  - SPDX-FileCopyrightText: 2026 Hoang Pham
  - SPDX-License-Identifier: AGPL-3.0-or-later
-->
<script setup lang="ts">
import type { OfficeCard } from '../api.ts'

import { mdiDoorOpen, mdiHeadset } from '@mdi/js'
import { getCurrentUser, getRequestToken } from '@nextcloud/auth'
import { n, t } from '@nextcloud/l10n'
import { listen } from '@nextcloud/notify_push'
import { generateUrl } from '@nextcloud/router'
import { computed, onBeforeUnmount, onMounted, ref, shallowRef } from 'vue'
import NcButton from '@nextcloud/vue/components/NcButton'
import NcIconSvgWrapper from '@nextcloud/vue/components/NcIconSvgWrapper'
import OfficeScene from '../components/OfficeScene.vue'
import WatchToggle from '../components/WatchToggle.vue'
import { catalog } from '../../shared/catalog.ts'
import { api } from '../api.ts'
import { emoteLabel, errorMessage } from '../labels.ts'
import { EMOTE_ICONS } from '../scene/renderer.ts'
import { RoomSession } from '../session/room.ts'

const props = defineProps<{ token: string, card: OfficeCard, onReady: (handle: { dispose: () => void }) => void }>()

const session = shallowRef(new RoomSession(
	props.token,
	getCurrentUser()?.uid ?? '',
	api,
	props.card.clientPush ? { listen: (handler) => listen('virtualoffice_room', (_type, body) => handler(body)) } : null,
	__CATALOG_HASH__,
	props.card.layoutId,
))
const scene = ref<InstanceType<typeof OfficeScene> | null>(null)
const officeUrl = generateUrl('/apps/virtualoffice/o/{token}', { token: props.token })
const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches

const status = computed(() => session.value.state.status)
const inside = computed(() => status.value === 'active' || status.value === 'reconnecting')
const call = computed(() => inside.value ? session.value.state.call : props.card.call)

async function enter(takeover = false) {
	await session.value.enter(takeover)
	if (inside.value) {
		setTimeout(() => scene.value?.focus(), 50)
	}
}

/** Leaves without waiting, for when Talk unmounts the message. */
function dispose() {
	const current = session.value
	if (current.isActive) {
		navigator.sendBeacon(
			generateUrl('/apps/virtualoffice/beacon/leave/{token}', { token: props.token }),
			new URLSearchParams({ session: current.sessionId, requesttoken: getRequestToken() ?? '' }),
		)
	}
	current.dispose()
}

function onVisibility() {
	session.value.setVisible(!document.hidden)
}

onMounted(() => {
	props.onReady({ dispose })
	document.addEventListener('visibilitychange', onVisibility)
	window.addEventListener('pagehide', dispose)
})

onBeforeUnmount(() => {
	document.removeEventListener('visibilitychange', onVisibility)
	window.removeEventListener('pagehide', dispose)
	dispose()
})
</script>

<template>
	<div class="embedded">
		<div v-if="call?.known && call.active" class="embedded__call">
			<NcIconSvgWrapper :path="mdiHeadset" :size="18" />
			{{ n('virtualoffice', 'Call in progress with %n person', 'Call in progress with %n people', call.participants.length) }}
		</div>

		<template v-if="inside">
			<OfficeScene ref="scene" :session="session" :reducedEffects="reduced" />
			<div class="embedded__controls">
				<NcButton
					v-for="emote in catalog.emotes"
					:key="emote.id"
					size="small"
					:aria-label="emoteLabel(emote.id)"
					:title="emoteLabel(emote.id)"
					@click="session.emote(emote.id)">
					<template #icon>
						<NcIconSvgWrapper :path="EMOTE_ICONS[emote.id]" :size="18" />
					</template>
				</NcButton>
				<span class="embedded__count">{{ n('virtualoffice', '%n here', '%n here', session.state.people.length) }}</span>
				<NcButton size="small" :href="officeUrl" target="_blank">
					{{ t('virtualoffice', 'Open full office') }}
				</NcButton>
				<NcButton size="small" variant="secondary" @click="session.leave()">
					{{ t('virtualoffice', 'Leave') }}
				</NcButton>
			</div>
		</template>

		<div v-else class="embedded__door">
			<p v-if="status === 'elsewhere'">
				{{ t('virtualoffice', 'You are in an office in another window.') }}
			</p>
			<p v-else-if="status === 'full'">
				{{ t('virtualoffice', 'The office is full right now.') }}
			</p>
			<p v-else-if="status === 'error' || status === 'closed' || status === 'removed'">
				{{ errorMessage(session.state.errorCode) }}
			</p>
			<p v-else>
				{{ t('virtualoffice', 'Step in right here. People in the office will see your character.') }}
			</p>
			<NcButton
				v-if="status === 'elsewhere'"
				variant="primary"
				size="small"
				@click="enter(true)">
				{{ t('virtualoffice', 'Continue here') }}
			</NcButton>
			<NcButton
				v-else
				variant="primary"
				size="small"
				:disabled="status === 'entering' || status === 'removed' || status === 'closed'"
				@click="enter(false)">
				<template #icon>
					<NcIconSvgWrapper :path="mdiDoorOpen" :size="18" />
				</template>
				{{ status === 'entering' ? t('virtualoffice', 'Entering…') : t('virtualoffice', 'Enter office') }}
			</NcButton>
			<WatchToggle v-if="card.canEnter && card.count === 0" :token="token" />
		</div>
	</div>
</template>

<style scoped>
.embedded {
	display: flex;
	flex-direction: column;
	gap: 8px;
}

.embedded__call {
	display: flex;
	align-items: center;
	gap: 6px;
	color: var(--color-success-text);
	font-weight: 600;
}

.embedded__controls, .embedded__door {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 6px;
}

.embedded__door p {
	flex-basis: 100%;
	color: var(--color-text-maxcontrast);
}

.embedded__count {
	margin-inline: auto 4px;
	color: var(--color-text-maxcontrast);
}
</style>
