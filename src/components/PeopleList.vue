<!--
  - SPDX-FileCopyrightText: 2026 Hoang Pham
  - SPDX-License-Identifier: AGPL-3.0-or-later
-->
<script setup lang="ts">
import type { PersonView, RoomSession } from '../session/room.ts'

import { mdiMusic, mdiWalk } from '@mdi/js'
import { getCapabilities } from '@nextcloud/capabilities'
import { n, t } from '@nextcloud/l10n'
import { generateUrl } from '@nextcloud/router'
import { useIsMobile } from '@nextcloud/vue/composables/useIsMobile'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import NcActionButton from '@nextcloud/vue/components/NcActionButton'
import NcActionLink from '@nextcloud/vue/components/NcActionLink'
import NcActions from '@nextcloud/vue/components/NcActions'
import NcAvatar from '@nextcloud/vue/components/NcAvatar'
import NcButton from '@nextcloud/vue/components/NcButton'
import NcIconSvgWrapper from '@nextcloud/vue/components/NcIconSvgWrapper'
import CreaturePreview from './CreaturePreview.vue'
import LocalClock from './LocalClock.vue'
import { deskLabel, emoteLabel, modeLabel, propLabel, statusLabel, zoneLabel } from '../labels.ts'
import { EMOTE_ICONS } from '../scene/renderer.ts'
import { audioDuration, playPosition } from '../session/music.ts'
import { clockOf } from '../session/time.ts'

const props = defineProps<{ session: RoomSession, canManage: boolean, managers: string[], talk?: boolean, inCall?: string[] }>()
const emit = defineEmits<{ walkTo: [uid: string], remove: [person: PersonView], feedback: [text: string], knock: [uid: string, name: string], call: [] }>()

const isMobile = useIsMobile()
const buttonSize = computed(() => isMobile.value ? 'normal' : 'small')
const layout = computed(() => props.session.layoutData)
const groups = computed(() => layout.value.zones.map((zone) => ({
	id: zone.id,
	label: zoneLabel(zone.id),
	people: props.session.state.people.filter((p) => p.zone === zone.id),
	props: layout.value.props.filter((p) => p.zone === zone.id),
})))

const focus = computed(() => props.session.state.focus)
const focusingNow = computed(() => focus.value?.uids.includes(props.session.state.people.find((p) => p.isYou)?.uid ?? '') ?? false)
/** Ticks so the minutes left stay current. */
const now = ref(props.session.clock.serverNow())
let ticker: ReturnType<typeof setInterval> | null = null
watch(focus, () => {
	now.value = props.session.clock.serverNow()
})
const minutesLeft = computed(() => focus.value ? Math.max(1, Math.ceil((focus.value.endsAt - now.value) / 60_000)) : 0)
onMounted(() => {
	ticker = setInterval(() => {
		now.value = props.session.clock.serverNow()
	}, 15_000)
})
onBeforeUnmount(() => {
	if (ticker !== null) {
		clearInterval(ticker)
	}
})

/** Desk owners who are not inside; people inside show in their zone. */
const absentOwners = computed(() => {
	const inside = new Set(props.session.state.people.map((p) => p.uid))
	return props.session.state.desks.filter((d) => !inside.has(d.uid))
})
const myDesk = computed(() => props.session.myDesk)

async function claimDesk() {
	if (!await props.session.claimNearestDesk()) {
		emit('feedback', t('virtualoffice', 'Every desk is taken'))
	}
}

/** "Away · In a meeting" for people who are not simply online. */
function statusText(status: PersonView['status']): string {
	if (!status || status.status === 'online') {
		return status?.message ?? ''
	}
	return [statusLabel(status.status), status.message].filter(Boolean).join(' · ')
}

/** Talk only opens its floating call when calls are enabled; otherwise the link would just leave the office. */
const callsEnabled = computed(() => Boolean((getCapabilities() as { spreed?: { config?: { call?: { enabled?: boolean } } } }).spreed?.config?.call?.enabled))

function directCallUrl(uid: string): string {
	return generateUrl('/apps/spreed/') + '?callUser=' + encodeURIComponent(uid) + '#direct-call'
}

function goTo(zone: string) {
	if (!props.session.walkToZone(zone)) {
		emit('feedback', t('virtualoffice', 'You are already there'))
	}
}

function useProp(id: string) {
	const outcome = props.session.useProp(id)
	if (outcome === 'unreachable') {
		emit('feedback', t('virtualoffice', 'That cannot be reached from here'))
	}
}

const music = computed(() => props.session.state.music)
/** The track playing now, by the shared timeline. */
const nowPlaying = computed(() => {
	const current = music.value
	const position = current ? playPosition(current, now.value) : null
	return current && position ? current.tracks[position.index].title : ''
})

/** Up to 10 of your own audio files; their length comes from the browser. */
async function playMusic() {
	const { getFilePickerBuilder } = await import('@nextcloud/dialogs')
	let nodes
	try {
		nodes = await getFilePickerBuilder(t('virtualoffice', 'Choose music to play for the office'))
			.setMultiSelect(true)
			.setMimeTypeFilter(['audio/*'])
			.addButton({ label: t('virtualoffice', 'Play'), variant: 'primary', callback: () => {} })
			.build()
			.pickNodes()
	} catch {
		return
	}
	if (nodes.length > 10) {
		emit('feedback', t('virtualoffice', 'The first 10 files play'))
	}
	const tracks = await Promise.all(nodes.slice(0, 10).map(async (node) => ({ fileId: node.fileid ?? 0, durationMs: await audioDuration(node.source) })))
	if (tracks.some((track) => track.durationMs === 0)) {
		emit('feedback', t('virtualoffice', 'This browser cannot play one of these files'))
		return
	}
	if (props.session.playMusic(tracks) === 'unreachable') {
		emit('feedback', t('virtualoffice', 'That cannot be reached from here'))
	}
}

function stopMusic() {
	if (props.session.stopMusic() === 'unreachable') {
		emit('feedback', t('virtualoffice', 'That cannot be reached from here'))
	}
}
</script>

<template>
	<section class="people" :aria-label="t('virtualoffice', 'People and places')">
		<div v-for="group in groups" :key="group.id" class="people__zone">
			<div class="people__zone-header">
				<h3>{{ group.label }} <span class="people__count">{{ group.people.length }}</span></h3>
				<NcButton variant="tertiary" :size="buttonSize" @click="goTo(group.id)">
					<template #icon>
						<NcIconSvgWrapper :path="mdiWalk" :size="18" />
					</template>
					{{ t('virtualoffice', 'Go here') }}
				</NcButton>
			</div>
			<div v-if="group.props.length || layout.player?.zone === group.id" class="people__props">
				<NcButton
					v-for="prop in group.props"
					:key="prop.id"
					:size="buttonSize"
					@click="useProp(prop.id)">
					{{ propLabel(prop.id) }}
				</NcButton>
				<NcButton
					v-if="layout.player?.zone === group.id && !music"
					:size="buttonSize"
					@click="playMusic">
					<template #icon>
						<NcIconSvgWrapper :path="mdiMusic" :size="18" />
					</template>
					{{ t('virtualoffice', 'Play music') }}
				</NcButton>
			</div>
			<div v-if="music && layout.player?.zone === group.id" class="people__music" role="status">
				<NcIconSvgWrapper :path="mdiMusic" :size="18" />
				<span class="people__music-title">{{ t('virtualoffice', 'Now playing: {title} · {name}', { title: nowPlaying, name: music.name }) }}</span>
				<NcButton :size="buttonSize" variant="tertiary" @click="stopMusic">
					{{ t('virtualoffice', 'Stop') }}
				</NcButton>
			</div>
			<ul v-if="group.people.length">
				<li v-for="person in group.people" :key="person.uid" class="person">
					<span class="person__avatar">
						<NcAvatar
							:user="person.uid"
							:displayName="person.name"
							:size="32"
							disableMenu
							hideStatus />
						<CreaturePreview class="person__creature" :appearance="person.appearance" :size="22" />
					</span>
					<span class="person__text">
						<span class="person__name"><template v-if="person.isYou">{{ t('virtualoffice', '{name} (you)', { name: person.name }) }}</template><template v-else>{{ person.name }}</template></span>
						<span class="person__mode" :data-mode="person.mode">
							{{ modeLabel(person.mode) }}<template v-if="clockOf(session.state.times[person.uid], now)"> · <LocalClock :info="session.state.times[person.uid]" :now="now" /></template><template v-if="inCall?.includes(person.uid)"> · {{ t('virtualoffice', 'In the call') }}</template><template v-if="statusText(person.status)"> · {{ statusText(person.status) }}</template><template v-if="person.focusing"> · {{ t('virtualoffice', 'Focusing together') }}</template><template v-if="person.birthday"> · 🎈 {{ t('virtualoffice', 'Birthday today') }}</template>
						</span>
						<span v-if="person.note" class="person__note">{{ person.note }}</span>
					</span>
					<span v-if="person.emote && session.emoteShowing(person)" class="person__emote" :title="emoteLabel(person.emote.id)">
						<NcIconSvgWrapper :path="EMOTE_ICONS[person.emote.id]" :size="18" :name="emoteLabel(person.emote.id)" />
					</span>
					<NcActions v-if="!person.isYou" :aria-label="t('virtualoffice', 'Actions for {name}', { name: person.name })">
						<NcActionButton closeAfterClick @click="emit('walkTo', person.uid)">
							{{ t('virtualoffice', 'Walk over') }}
						</NcActionButton>
						<NcActionButton closeAfterClick @click="emit('knock', person.uid, person.name)">
							{{ t('virtualoffice', 'Knock: got 2 minutes?') }}
						</NcActionButton>
						<!-- Talk opens a floating call on this page for links of this exact form. -->
						<NcActionLink
							v-if="talk && callsEnabled"
							:href="directCallUrl(person.uid)"
							closeAfterClick
							@click="emit('call')">
							{{ t('virtualoffice', 'Call') }}
						</NcActionLink>
						<NcActionButton v-if="canManage && !managers.includes(person.uid)" closeAfterClick @click="emit('remove', person)">
							{{ t('virtualoffice', 'Remove from office for 1 hour') }}
						</NcActionButton>
					</NcActions>
				</li>
			</ul>
			<p v-else class="people__empty">
				{{ t('virtualoffice', 'Nobody here') }}
			</p>
		</div>
		<div class="people__zone people__focus">
			<div class="people__zone-header">
				<h3>{{ t('virtualoffice', 'Focus together') }} <span v-if="focus" class="people__count">{{ focus.uids.length }}</span></h3>
			</div>
			<p class="people__empty">
				{{ focus
					? n('virtualoffice', '%n minute left', '%n minutes left', minutesLeft)
					: t('virtualoffice', 'Work quietly next to others for a while.') }}
			</p>
			<div class="people__props">
				<template v-if="!focus">
					<NcButton :size="buttonSize" @click="session.startFocus(25)">
						{{ t('virtualoffice', '25 minutes') }}
					</NcButton>
					<NcButton :size="buttonSize" @click="session.startFocus(50)">
						{{ t('virtualoffice', '50 minutes') }}
					</NcButton>
				</template>
				<NcButton
					v-else-if="!focusingNow"
					:size="buttonSize"
					variant="primary"
					@click="session.startFocus(focus.minutes)">
					{{ t('virtualoffice', 'Join the focus session') }}
				</NcButton>
				<NcButton v-else :size="buttonSize" @click="session.leaveFocus()">
					{{ t('virtualoffice', 'Leave the focus session') }}
				</NcButton>
			</div>
		</div>
		<div v-if="session.state.resources.length" class="people__zone people__places">
			<div class="people__zone-header">
				<h3>{{ t('virtualoffice', 'Team places') }}</h3>
			</div>
			<ul>
				<li v-for="resource in session.state.resources" :key="`${resource.provider}:${resource.id}`" class="place">
					<a :href="resource.url" target="_blank" rel="noopener">{{ resource.label }}</a>
					<span v-if="resource.badge" class="place__badge">{{ resource.badge }}</span>
				</li>
			</ul>
		</div>
		<div class="people__zone people__desks">
			<div class="people__zone-header">
				<h3>{{ t('virtualoffice', 'Desks') }}</h3>
				<NcButton
					v-if="myDesk"
					variant="tertiary"
					:size="buttonSize"
					@click="session.releaseDesk(myDesk.deskId)">
					{{ t('virtualoffice', 'Free {desk}', { desk: deskLabel(myDesk.deskId) }) }}
				</NcButton>
				<NcButton
					v-else
					variant="tertiary"
					:size="buttonSize"
					@click="claimDesk">
					{{ t('virtualoffice', 'Claim a desk') }}
				</NcButton>
			</div>
			<ul v-if="absentOwners.length">
				<li v-for="owner in absentOwners" :key="owner.deskId" class="person">
					<span class="person__avatar">
						<NcAvatar
							:user="owner.uid"
							:displayName="owner.name"
							:size="32"
							disableMenu
							hideStatus />
					</span>
					<span class="person__text">
						<span class="person__name">{{ owner.name }}<template v-if="owner.birthday"> 🎈</template></span>
						<span class="person__mode">
							{{ deskLabel(owner.deskId) }}<template v-if="clockOf(session.state.times[owner.uid], now)"> · <LocalClock :info="session.state.times[owner.uid]" :now="now" /></template><template v-if="statusText(session.state.statuses[owner.uid] ?? null)"> · {{ statusText(session.state.statuses[owner.uid] ?? null) }}</template>
						</span>
						<span v-if="owner.note" class="person__note">{{ owner.note }}</span>
					</span>
					<NcActions :aria-label="t('virtualoffice', 'Actions for {name}', { name: owner.name })">
						<NcActionButton closeAfterClick @click="emit('knock', owner.uid, owner.name)">
							{{ t('virtualoffice', 'Knock: got 2 minutes?') }}
						</NcActionButton>
						<NcActionButton v-if="canManage" closeAfterClick @click="session.releaseDesk(owner.deskId)">
							{{ t('virtualoffice', 'Free this desk') }}
						</NcActionButton>
					</NcActions>
				</li>
			</ul>
			<p v-else class="people__empty">
				{{ myDesk ? t('virtualoffice', 'Your desk is {desk}.', { desk: deskLabel(myDesk.deskId) }) : t('virtualoffice', 'Claim a desk so others see your status and note while you are away.') }}
			</p>
		</div>
	</section>
</template>

<style scoped>
.people__zone {
	padding: 8px 0;
	border-bottom: 1px solid var(--color-border);
}

.people__zone-header {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 8px;
}

.people__zone h3 {
	margin: 0;
	font-size: 1em;
	font-weight: 700;
}

.people__count {
	margin-inline-start: 4px;
	color: var(--color-text-maxcontrast);
	font-weight: 400;
}

.people__props {
	display: flex;
	flex-wrap: wrap;
	gap: 6px;
	margin: 6px 0;
}

.people__music {
	display: flex;
	align-items: center;
	gap: 6px;
	margin: 6px 0;
}

.people__music-title {
	flex: 1;
	min-width: 0;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.people__empty {
	color: var(--color-text-maxcontrast);
	font-size: .9em;
}

.person {
	display: flex;
	align-items: center;
	gap: 10px;
	min-height: 44px;
}

.person__avatar {
	position: relative;
	flex: none;
}

.person__creature {
	position: absolute;
	right: -8px;
	bottom: -6px;
}

.person__text {
	display: flex;
	flex: 1;
	flex-direction: column;
	min-width: 0;
}

.person__name {
	overflow: hidden;
	font-weight: 600;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.person__mode {
	color: var(--color-text-maxcontrast);
	font-size: .9em;
}

.place {
	display: flex;
	align-items: center;
	gap: 8px;
	min-height: 32px;
}

.place a {
	overflow: hidden;
	text-decoration: underline;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.place__badge {
	padding: 0 6px;
	border-radius: 999px;
	background: var(--color-error);
	color: #fff;
	font-size: .8em;
	font-weight: 700;
}

.person__note {
	overflow: hidden;
	font-size: .9em;
	font-style: italic;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.person__mode[data-mode='focus']::before { content: '■ '; color: #e0565b; }
.person__mode[data-mode='available']::before { content: '● '; color: #49b36b; }
.person__mode[data-mode='away']::before { content: '○ '; color: #b58f2d; }
</style>
