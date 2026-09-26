<!--
  - SPDX-FileCopyrightText: 2026 Hoang Pham
  - SPDX-License-Identifier: AGPL-3.0-or-later
-->
<script setup lang="ts">
import type { Appearance } from '../../shared/catalog.ts'
import type { KnockAnswer, KnockEvent } from '../api.ts'
import type { Announcement, PersonView } from '../session/room.ts'
import type { InitialConfig, OfficeDefinition, Preferences, TeamResource } from '../types.ts'

import { mdiArrowLeft, mdiCog, mdiDoorOpen, mdiFormatListBulleted, mdiHeadset, mdiMap, mdiMessageText, mdiPhone, mdiShareVariant, mdiTshirtCrew } from '@mdi/js'
import { getRequestToken } from '@nextcloud/auth'
import axios from '@nextcloud/axios'
import { n, t } from '@nextcloud/l10n'
import { listen } from '@nextcloud/notify_push'
import { generateOcsUrl, generateUrl, imagePath } from '@nextcloud/router'
import { useIsMobile } from '@nextcloud/vue/composables/useIsMobile'
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch, watchEffect } from 'vue'
import NcActionCheckbox from '@nextcloud/vue/components/NcActionCheckbox'
import NcActions from '@nextcloud/vue/components/NcActions'
import NcButton from '@nextcloud/vue/components/NcButton'
import NcEmptyContent from '@nextcloud/vue/components/NcEmptyContent'
import NcIconSvgWrapper from '@nextcloud/vue/components/NcIconSvgWrapper'
import NcLoadingIcon from '@nextcloud/vue/components/NcLoadingIcon'
import NcNoteCard from '@nextcloud/vue/components/NcNoteCard'
import AppearancePicker from '../components/AppearancePicker.vue'
import CreaturePreview from '../components/CreaturePreview.vue'
import OfficeScene from '../components/OfficeScene.vue'
import OfficeSettingsDialog from '../components/OfficeSettingsDialog.vue'
import PeopleList from '../components/PeopleList.vue'
import RouletteToggle from '../components/RouletteToggle.vue'
import TodayNote from '../components/TodayNote.vue'
import WatchToggle from '../components/WatchToggle.vue'
import { catalog } from '../../shared/catalog.ts'
import { api, ApiError } from '../api.ts'
import { emoteLabel, errorMessage, knockAnswerLabel, modeLabel, pairLabel } from '../labels.ts'
import { EMOTE_ICONS } from '../scene/renderer.ts'
import { RoomSession } from '../session/room.ts'
import { postMessage } from '../talk.ts'

const props = defineProps<{ config: InitialConfig }>()
const token = props.config.token ?? ''
const isMobile = useIsMobile()

const office = ref<OfficeDefinition | null>(null)
const loadError = ref('')
const preferences = ref<Preferences | null>(null)
const preferencesRevision = ref(0)
const session = shallowRef<RoomSession | null>(null)
const showAppearance = ref(false)
const showSettings = ref(false)
const savingAppearance = ref(false)
const feedback = ref('')
const liveText = ref('')
/** Arrivals, reactions with you and knocks while the tab was hidden. */
const unseen = ref(0)
/** A knock on you, and the answer to your knock, from Client Push. */
const knockIn = ref<{ id: number, name: string } | null>(null)
const knockAnswer = ref<{ name: string, answer: KnockAnswer, link: string | null } | null>(null)
const resources = ref<TeamResource[]>([])
/** Deck cards due today or overdue, per board id. */
const deckDue = ref<Record<string, number>>({})
/** Offices of the Teams this conversation belongs to. */
const teamOffices = ref<{ token: string, title: string, url: string }[]>([])
let deckTimer: ReturnType<typeof setInterval> | null = null
let countTimer: ReturnType<typeof setInterval> | null = null
const scene = ref<InstanceType<typeof OfficeScene> | null>(null)
let feedbackTimer: ReturnType<typeof setTimeout> | null = null
let announceTimer: ReturnType<typeof setTimeout> | null = null
const pendingAnnouncements: string[] = []

const status = computed(() => session.value?.state.status ?? 'idle')
const inRoom = computed(() => status.value === 'active' || status.value === 'reconnecting')
const appearance = computed<Appearance>(() => preferences.value?.appearance ?? catalog.defaults.appearance)
const view = computed(() => preferences.value?.ui.view ?? (isMobile.value ? 'list' : 'scene'))
const reducedEffects = computed(() => preferences.value?.ui.reducedEffects ?? false)
const announcementsOn = computed(() => preferences.value?.ui.announcements ?? true)
const you = computed<PersonView | undefined>(() => session.value?.state.people.find((p) => p.isYou))
const talkUrl = computed(() => generateUrl('/apps/virtualoffice/o/{token}/talk', { token }))
const people = computed(() => session.value?.state.people.length ?? 0)
const call = computed(() => inRoom.value ? session.value?.state.call ?? null : office.value?.call ?? null)
const callRunning = computed(() => Boolean(call.value?.known && call.value.active))
/** Talk's #direct-call joins the running call or starts one; say so while the state is unknown. */
const callLabel = computed(() => callRunning.value
	? t('virtualoffice', 'Join call')
	: call.value?.known ? t('virtualoffice', 'Start call') : t('virtualoffice', 'Join or start call'))
const callNames = computed(() => (call.value?.participants ?? []).map((uid) => call.value?.names[uid] ?? uid))
const audienceText = computed(() => office.value?.audience.kind === 'talk'
	? t('virtualoffice', 'Talk conversation {name}', { name: office.value.audience.label })
	: office.value?.audience.label ?? '')
/** Compact buttons on desktop, full touch targets on phones. */
const buttonSize = computed(() => isMobile.value ? 'normal' : 'small')

function say(text: string) {
	feedback.value = text
	if (feedbackTimer) {
		clearTimeout(feedbackTimer)
	}
	feedbackTimer = setTimeout(() => {
		feedback.value = ''
	}, 3500)
}

/**
 * Screen reader announcements, grouped so walking around does not flood them.
 * Arrivals, reactions with you and the end of your focus session also count
 * toward the tab title while hidden.
 */
function announce(announcement: Announcement) {
	let text: string
	if (announcement.kind === 'pair') {
		text = pairLabel(announcement.emote, ...announcement.names)
		if (announcement.withYou) {
			say(text)
		}
	} else if (announcement.kind === 'focus-done') {
		text = t('virtualoffice', 'Focus session done. Nice work!')
		say(text)
	} else {
		text = announcement.kind === 'enter'
			? t('virtualoffice', '{name} came in', { name: announcement.name })
			: t('virtualoffice', '{name} left', { name: announcement.name })
	}
	if (document.hidden && (announcement.kind === 'enter' || announcement.kind === 'focus-done' || (announcement.kind === 'pair' && announcement.withYou))) {
		unseen.value++
	}
	if (!announcementsOn.value) {
		return
	}
	pendingAnnouncements.push(text)
	if (announceTimer === null) {
		announceTimer = setTimeout(() => {
			liveText.value = pendingAnnouncements.splice(0).join('. ')
			announceTimer = null
		}, 2000)
	}
}

async function knock(uid: string, name: string) {
	try {
		await api.knock(token, uid)
		say(t('virtualoffice', 'You knocked. {name} gets a notification.', { name }))
	} catch (e) {
		say(errorMessage(e instanceof ApiError ? e.code : 'UNKNOWN'))
	}
}

/** Knocks for other offices show in the notifications. */
function onKnockEvent(event: KnockEvent) {
	if (event.office !== token) {
		return
	}
	if (event.kind === 'knock') {
		knockIn.value = { id: event.id, name: event.name }
	} else {
		knockAnswer.value = { name: event.name, answer: event.answer, link: event.link }
	}
	if (document.hidden) {
		unseen.value++
	}
}

async function answerKnock(answer: KnockAnswer) {
	const knocked = knockIn.value
	knockIn.value = null
	if (!knocked) {
		return
	}
	try {
		const { link } = await api.answerKnock(knocked.id, answer)
		if (link) {
			openLink(link)
		}
	} catch (e) {
		say(errorMessage(e instanceof ApiError ? e.code : 'UNKNOWN'))
	}
}

/**
 * "Now" in a knock notification opens this page with ?knock=…&answer=now:
 * answer it, then continue to the call in this tab.
 */
async function answerFromNotification() {
	const params = new URLSearchParams(window.location.search)
	const id = Number(params.get('knock'))
	if (!id || params.get('answer') !== 'now') {
		return
	}
	window.history.replaceState(null, '', window.location.pathname)
	try {
		const { link } = await api.answerKnock(id, 'now')
		if (link) {
			window.location.assign(link)
		}
	} catch (e) {
		say(errorMessage(e instanceof ApiError ? e.code : 'UNKNOWN'))
	}
}

/** Talk links open in a new tab on desktop, so the office stays open. */
function openLink(url: string) {
	if (isMobile.value) {
		window.location.href = url
	} else {
		window.open(url, '_blank', 'noopener')
	}
}

/** Team resources for the wall, with Deck due counts and the linked call as badges. */
async function loadResources() {
	if (office.value?.audience.kind !== 'team') {
		return
	}
	resources.value = await api.resources(token).catch(() => [])
	if (resources.value.some((r) => r.provider === 'deck')) {
		await loadDeckDue()
		deckTimer ??= setInterval(loadDeckDue, 5 * 60_000)
	}
}

async function loadDeckDue() {
	try {
		const overview = (await axios.get(generateOcsUrl('/apps/deck/api/v1.0/overview/upcoming'))).data.ocs.data as Record<string, { boardId?: number }[]>
		const due: Record<string, number> = {}
		for (const card of [...(overview.overdue ?? []), ...(overview.today ?? [])]) {
			if (card.boardId !== undefined) {
				due[String(card.boardId)] = (due[String(card.boardId)] ?? 0) + 1
			}
		}
		deckDue.value = due
	} catch {
		// Badges are optional.
	}
}

watch([resources, deckDue, () => session.value?.state.call], () => {
	if (!session.value) {
		return
	}
	const linked = office.value?.config.talk?.token
	session.value.state.resources = resources.value.map((resource) => ({
		...resource,
		badge: resource.provider === 'deck' && deckDue.value[resource.id]
			? String(deckDue.value[resource.id])
			: resource.provider === 'talk' && resource.id === linked && callRunning.value ? t('virtualoffice', 'Call') : null,
	}))
})

/** Invites the conversation in: Talk shows the office link as a live card. */
async function shareToChat() {
	const conversation = office.value?.config.talk?.token
	if (!conversation || !office.value) {
		return
	}
	try {
		await postMessage(conversation, t('virtualoffice', 'I am in the office, come by: {url}', { url: office.value.url }))
		say(t('virtualoffice', 'Posted to the conversation'))
	} catch {
		say(t('virtualoffice', 'Could not post to the conversation'))
	}
}

async function load() {
	try {
		const [definition, prefs] = await Promise.all([api.getOffice(token), api.preferences()])
		office.value = definition
		void answerFromNotification()
		if (definition.audience.kind === 'talk') {
			api.teamOffices(definition.audience.id).then((found) => {
				teamOffices.value = found
			}).catch(() => {})
		}
		preferences.value = prefs.preferences
		preferencesRevision.value = prefs.revision
		session.value = new RoomSession(
			token,
			props.config.uid ?? '',
			api,
			props.config.clientPush ? { listen: (handler) => listen('virtualoffice_room', (_type, body) => handler(body)) } : null,
			__CATALOG_HASH__,
			definition.layoutId,
			announce,
		)
	} catch (e) {
		loadError.value = e instanceof ApiError ? e.code : 'UNKNOWN'
	}
}

async function enter(takeover = false) {
	await session.value?.enter(takeover)
	if (inRoom.value && resources.value.length === 0) {
		void loadResources()
	}
	if (inRoom.value && view.value === 'scene') {
		setTimeout(() => scene.value?.focus(), 50)
	}
}

async function leave() {
	await session.value?.leave()
	// Only now does the server no longer count you in.
	await refreshOffice()
}

async function refreshOffice() {
	office.value = await api.getOffice(token).catch(() => office.value)
}

/** Opens the conversation, or joins its call, through the access-checked redirect. */
function openTalk(join = false) {
	openLink(talkUrl.value + (join ? '#direct-call' : ''))
}

/** Preferences as shown now, with defaults for anything not saved yet. */
function currentPreferences(stored: Preferences | null = preferences.value): Preferences {
	return {
		appearance: stored?.appearance ?? catalog.defaults.appearance,
		ui: {
			view: stored?.ui.view ?? (isMobile.value ? 'list' : 'scene'),
			reducedEffects: stored?.ui.reducedEffects ?? false,
			announcements: stored?.ui.announcements ?? true,
		},
	}
}

/**
 * Saves one change. When another window saved in between, the change is
 * applied to its preferences instead of overwriting them.
 */
async function updatePreferences(change: (current: Preferences) => Preferences, attempt = 0): Promise<boolean> {
	try {
		const saved = await api.savePreferences(preferencesRevision.value, change(currentPreferences()))
		preferences.value = saved.preferences
		preferencesRevision.value = saved.revision
		return true
	} catch (e) {
		if (e instanceof ApiError && (e.code === 'REVISION_MISMATCH' || e.code === 'CONFLICT') && attempt < 3) {
			const fresh = e.code === 'REVISION_MISMATCH' && typeof e.data.revision === 'number'
				? e.data as { revision: number, preferences: Preferences | null }
				: await api.preferences()
			preferences.value = fresh.preferences
			preferencesRevision.value = fresh.revision
			return updatePreferences(change, attempt + 1)
		}
		say(errorMessage(e instanceof ApiError ? e.code : 'UNKNOWN'))
		return false
	}
}

function setUi(change: Partial<Preferences['ui']>) {
	return updatePreferences((current) => ({ ...current, ui: { ...current.ui, ...change } }))
}

async function saveAppearance(next: Appearance) {
	savingAppearance.value = true
	if (await updatePreferences((current) => ({ ...current, appearance: next }))) {
		showAppearance.value = false
		if (inRoom.value) {
			await session.value?.refreshProfile()
		}
	}
	savingAppearance.value = false
}

async function removePerson(person: PersonView) {
	if (!office.value || !window.confirm(t('virtualoffice', 'Remove {name} from this office for 1 hour?', { name: person.name }))) {
		return
	}
	try {
		office.value = await api.removePerson(token, person.uid, 60)
		say(t('virtualoffice', '{name} was removed for 1 hour', { name: person.name }))
	} catch (e) {
		say(errorMessage(e instanceof ApiError ? e.code : 'UNKNOWN'))
	}
}

/**
 * From the list: walk next to someone, also when the map is hidden.
 */
function walkTo(uid: string) {
	if (scene.value) {
		scene.value.walkNextTo(uid)
		return
	}
	const current = session.value
	const motion = current?.motions.get(uid)
	if (!current || !motion) {
		return
	}
	const [x, y] = motion.trajectory.points[motion.trajectory.points.length - 1]
	for (const [dx, dy] of [[0, 1], [1, 0], [-1, 0], [0, -1]]) {
		if (current.walkTo([Math.round(x) + dx, Math.round(y) + dy])) {
			return
		}
	}
}

function goToDirectory() {
	window.location.href = generateUrl('/apps/virtualoffice/')
}

function onPageHide() {
	const current = session.value
	if (current?.isActive) {
		navigator.sendBeacon(
			generateUrl('/apps/virtualoffice/beacon/leave/{token}', { token }),
			new URLSearchParams({ session: current.sessionId, requesttoken: getRequestToken() ?? '' }),
		)
		current.dispose()
	}
}

function onVisibility() {
	session.value?.setVisible(!document.hidden)
	if (!document.hidden) {
		unseen.value = 0
	}
}

watchEffect(() => {
	if (office.value) {
		document.title = `${unseen.value > 0 ? `(${unseen.value}) ` : ''}${office.value.title} - ${t('virtualoffice', 'Virtual Office')}`
	}
})

watch(() => session.value?.state.errorCode, (code) => {
	if (code && inRoom.value) {
		say(errorMessage(code))
		session.value!.state.errorCode = ''
	}
})

// Permissions and counts may have changed when a visit ends. Your own
// "Leave" refreshes once the server has removed you.
watch(status, (next, previous) => {
	if ((previous === 'active' || previous === 'reconnecting') && !inRoom.value && next !== 'left') {
		void refreshOffice()
	}
})

/** Keeps "n people here" current while you look at the door. */
async function refreshCount() {
	if (document.hidden || inRoom.value || !office.value?.permissions.isMember) {
		return
	}
	const [summary] = await api.summaries([token]).catch(() => [])
	if (summary && office.value) {
		office.value = { ...office.value, count: summary.count }
	}
}

watch(() => session.value?.state.title, (title) => {
	if (title && office.value && title !== office.value.title) {
		office.value = { ...office.value, title }
	}
})

onMounted(() => {
	load()
	countTimer = setInterval(refreshCount, 30_000)
	if (props.config.clientPush) {
		listen('virtualoffice_knock', (_type, body) => onKnockEvent(body as KnockEvent))
	}
	window.addEventListener('pagehide', onPageHide)
	document.addEventListener('visibilitychange', onVisibility)
})

onBeforeUnmount(() => {
	if (deckTimer !== null) {
		clearInterval(deckTimer)
	}
	if (countTimer !== null) {
		clearInterval(countTimer)
	}
	window.removeEventListener('pagehide', onPageHide)
	document.removeEventListener('visibilitychange', onVisibility)
	session.value?.dispose()
})
</script>

<template>
	<main class="office">
		<NcLoadingIcon
			v-if="!office && !loadError"
			:size="44"
			:name="t('virtualoffice', 'Loading the office')"
			class="office__loading" />

		<NcEmptyContent
			v-else-if="loadError"
			:name="t('virtualoffice', 'Office not available')"
			:description="errorMessage(loadError)">
			<template #action>
				<NcButton :href="generateUrl('/apps/virtualoffice/')">
					{{ t('virtualoffice', 'All offices') }}
				</NcButton>
			</template>
		</NcEmptyContent>

		<template v-else-if="office && session">
			<!-- Before entering -->
			<section v-if="!inRoom" class="landing">
				<a class="landing__back" :href="generateUrl('/apps/virtualoffice/')">
					<NcIconSvgWrapper :path="mdiArrowLeft" :size="18" /> {{ t('virtualoffice', 'All offices') }}
				</a>
				<div class="landing__card">
					<div class="landing__art">
						<img class="landing__preview" :src="imagePath('virtualoffice', 'office-preview.webp')" alt="">
						<span class="landing__character"><CreaturePreview :appearance="appearance" :size="56" /></span>
					</div>
					<div class="landing__text">
						<h2>{{ office.title }}</h2>
						<p class="landing__meta">
							{{ audienceText }} ·
							<template v-if="office.count">
								{{ n('virtualoffice', '%n person here', '%n people here', office.count) }}
							</template>
							<template v-else>
								{{ t('virtualoffice', 'Nobody here right now') }}
							</template>
						</p>
						<p v-if="callRunning && call" class="call-line">
							<NcIconSvgWrapper :path="mdiHeadset" :size="20" />
							{{ n('virtualoffice', 'Call in progress with %n person', 'Call in progress with %n people', call.participants.length) }}
						</p>
						<p>{{ t('virtualoffice', 'When you enter, people in the office see your name and character. You can leave at any time. The office does not keep a history of who was here.') }}</p>

						<NcNoteCard v-if="status === 'elsewhere'" type="info">
							<p>{{ session.state.sameOffice ? t('virtualoffice', 'You are already in this office in another window or device.') : t('virtualoffice', 'You are in another office right now.') }}</p>
							<NcButton variant="primary" @click="enter(true)">
								{{ t('virtualoffice', 'Continue here') }}
							</NcButton>
						</NcNoteCard>
						<NcNoteCard v-else-if="status === 'taken-over'" type="info" :text="t('virtualoffice', 'You continued in another window. This window left the office.')" />
						<NcNoteCard v-else-if="status === 'full'" type="warning" :text="t('virtualoffice', 'The office is full right now. Try again a bit later or meet in Talk.')" />
						<NcNoteCard
							v-else-if="status === 'removed' || (office.removedUntil && !office.permissions.canEnter)"
							type="warning"
							:text="t('virtualoffice', 'A manager removed you from this office for a while. You can come back later.')" />
						<NcNoteCard v-else-if="status === 'expired'" type="info" :text="t('virtualoffice', 'You were away for a while, so you left the office.')" />
						<NcNoteCard v-else-if="status === 'closed'" type="warning" :text="t('virtualoffice', 'This office is no longer available to you.')" />
						<NcNoteCard v-else-if="status === 'outdated'" type="warning" :text="t('virtualoffice', 'Virtual Office was updated. Reload the page to enter.')" />
						<NcNoteCard v-else-if="status === 'error'" type="error" :text="errorMessage(session.state.errorCode)" />

						<div class="landing__actions">
							<NcButton
								variant="primary"
								size="large"
								:disabled="!office.permissions.canEnter || ['entering', 'outdated', 'closed', 'removed'].includes(status)"
								@click="enter(false)">
								<template #icon>
									<NcIconSvgWrapper :path="mdiDoorOpen" />
								</template>
								{{ status === 'entering' ? t('virtualoffice', 'Entering…') : t('virtualoffice', 'Enter office') }}
							</NcButton>
							<NcButton @click="showAppearance = true">
								<template #icon>
									<NcIconSvgWrapper :path="mdiTshirtCrew" />
								</template>
								{{ t('virtualoffice', 'Change character') }}
							</NcButton>
							<NcButton v-if="office.talkAvailable" @click="openTalk(false)">
								<template #icon>
									<NcIconSvgWrapper :path="mdiMessageText" />
								</template>
								{{ t('virtualoffice', 'Open chat') }}
							</NcButton>
							<NcButton v-if="office.talkAvailable" :variant="callRunning ? 'success' : 'secondary'" @click="openTalk(true)">
								<template #icon>
									<NcIconSvgWrapper :path="mdiPhone" />
								</template>
								{{ callLabel }}
							</NcButton>
							<NcButton v-if="office.permissions.canManage" variant="tertiary" @click="showSettings = true">
								<template #icon>
									<NcIconSvgWrapper :path="mdiCog" />
								</template>
								{{ t('virtualoffice', 'Settings') }}
							</NcButton>
						</div>
						<!-- Below the buttons: these load later and must not move them. -->
						<div class="landing__extras">
							<TodayNote v-if="office.permissions.canEnter" class="landing__today" @feedback="say" />
							<WatchToggle v-if="office.permissions.canEnter && !office.count" :token="token" />
							<RouletteToggle v-if="office.permissions.canEnter && (office.audience.kind === 'group' || office.audience.kind === 'instance')" :token="token" />
							<p v-for="teamOffice in teamOffices" :key="teamOffice.token" class="landing__team">
								{{ t('virtualoffice', 'This conversation belongs to a Team with its own office:') }}
								<a :href="teamOffice.url">{{ teamOffice.title }}</a>
							</p>
						</div>
					</div>
				</div>
			</section>

			<!-- In the office -->
			<section v-else class="room" :data-transport="session.state.pushActive ? 'push' : 'polling'">
				<header class="room__header">
					<div class="room__title">
						<h2>{{ session.state.title || office.title }}</h2>
						<span class="room__meta">
							{{ audienceText }} · {{ n('virtualoffice', '%n of {capacity} here', '%n of {capacity} here', people, { capacity: session.state.capacity }) }}
						</span>
					</div>
					<div class="room__header-actions">
						<div class="room__view" role="group" :aria-label="t('virtualoffice', 'View')">
							<NcButton :pressed="view === 'scene'" :aria-label="t('virtualoffice', 'Map')" @update:pressed="setUi({ view: 'scene' })">
								<template #icon>
									<NcIconSvgWrapper :path="mdiMap" />
								</template>
							</NcButton>
							<NcButton :pressed="view === 'list'" :aria-label="t('virtualoffice', 'List')" @update:pressed="setUi({ view: 'list' })">
								<template #icon>
									<NcIconSvgWrapper :path="mdiFormatListBulleted" />
								</template>
							</NcButton>
						</div>
						<NcButton v-if="office.talkAvailable" @click="openTalk(false)">
							<template #icon>
								<NcIconSvgWrapper :path="mdiMessageText" />
							</template>
							{{ t('virtualoffice', 'Open chat') }}
						</NcButton>
						<NcButton
							v-if="office.talkAvailable && office.config.talk?.token"
							:aria-label="t('virtualoffice', 'Share to chat')"
							:title="t('virtualoffice', 'Share to chat')"
							@click="shareToChat">
							<template #icon>
								<NcIconSvgWrapper :path="mdiShareVariant" />
							</template>
						</NcButton>
						<NcButton v-if="office.talkAvailable && !callRunning" @click="openTalk(true)">
							<template #icon>
								<NcIconSvgWrapper :path="mdiPhone" />
							</template>
							{{ callLabel }}
						</NcButton>
						<NcActions :aria-label="t('virtualoffice', 'More')">
							<NcActionCheckbox :modelValue="reducedEffects" @update:modelValue="(value) => setUi({ reducedEffects: value })">
								{{ t('virtualoffice', 'Reduce motion') }}
							</NcActionCheckbox>
							<NcActionCheckbox :modelValue="announcementsOn" @update:modelValue="(value) => setUi({ announcements: value })">
								{{ t('virtualoffice', 'Announce arrivals for screen readers') }}
							</NcActionCheckbox>
						</NcActions>
						<NcButton
							v-if="office.permissions.canManage"
							variant="tertiary"
							:aria-label="t('virtualoffice', 'Settings')"
							@click="showSettings = true">
							<template #icon>
								<NcIconSvgWrapper :path="mdiCog" />
							</template>
						</NcButton>
						<NcButton variant="secondary" @click="leave">
							{{ t('virtualoffice', 'Leave') }}
						</NcButton>
					</div>
				</header>

				<NcNoteCard v-if="status === 'reconnecting'" type="warning" :text="t('virtualoffice', 'Connection lost. Reconnecting… What you see may be out of date.')" />

				<div v-if="callRunning" class="room__call" role="status">
					<NcIconSvgWrapper :path="mdiHeadset" :size="20" />
					<span>
						{{ callNames.length
							? t('virtualoffice', 'Call in progress with {names}', { names: callNames.join(', ') })
							: t('virtualoffice', 'Call in progress') }}
					</span>
					<NcButton v-if="office.talkAvailable" variant="success" @click="openTalk(true)">
						<template #icon>
							<NcIconSvgWrapper :path="mdiPhone" />
						</template>
						{{ t('virtualoffice', 'Join call') }}
					</NcButton>
				</div>

				<div class="room__body" :class="{ 'room__body--list': view === 'list' }">
					<div v-if="view === 'scene'" class="room__scene">
						<OfficeScene
							ref="scene"
							:session="session"
							:reducedEffects="reducedEffects"
							@blocked="say(t('virtualoffice', 'You cannot walk there.'))" />
					</div>

					<aside class="room__panel">
						<div class="controls">
							<div class="controls__you">
								<CreaturePreview :appearance="appearance" :size="40" />
								<NcButton :size="buttonSize" @click="showAppearance = true">
									{{ t('virtualoffice', 'Change character') }}
								</NcButton>
							</div>
							<TodayNote @feedback="say" />
							<div class="controls__group" role="group" :aria-label="t('virtualoffice', 'Your status in the office')">
								<NcButton
									v-for="mode in catalog.modes"
									:key="mode"
									:size="buttonSize"
									:pressed="you?.mode === mode"
									@update:pressed="session.setMode(mode)">
									{{ modeLabel(mode) }}
								</NcButton>
							</div>
							<div class="controls__group" role="group" :aria-label="t('virtualoffice', 'Reactions')">
								<NcButton
									v-for="emote in catalog.emotes"
									:key="emote.id"
									:aria-label="emoteLabel(emote.id)"
									:title="emoteLabel(emote.id)"
									@click="session.emote(emote.id)">
									<template #icon>
										<NcIconSvgWrapper :path="EMOTE_ICONS[emote.id]" />
									</template>
								</NcButton>
							</div>
						</div>
						<PeopleList
							:session="session"
							:canManage="office.permissions.canManage"
							:talk="config.talk"
							:inCall="call?.active ? call.participants : []"
							:managers="(office.managers ?? []).map((m) => m.uid)"
							@walkTo="walkTo"
							@remove="removePerson"
							@knock="knock"
							@feedback="say" />
					</aside>
				</div>
			</section>

			<div
				v-if="knockIn"
				class="office__knock"
				role="alertdialog"
				:aria-label="t('virtualoffice', 'Knock')">
				<span>{{ t('virtualoffice', '{name} knocked: got 2 minutes?', { name: knockIn.name }) }}</span>
				<div class="office__knock-actions">
					<NcButton variant="primary" @click="answerKnock('now')">
						{{ t('virtualoffice', 'Now') }}
					</NcButton>
					<NcButton @click="answerKnock('soon')">
						{{ t('virtualoffice', 'In 10 minutes') }}
					</NcButton>
					<NcButton variant="tertiary" @click="answerKnock('later')">
						{{ t('virtualoffice', 'Later') }}
					</NcButton>
				</div>
			</div>
			<div v-else-if="knockAnswer" class="office__knock" role="status">
				<span>{{ knockAnswerLabel(knockAnswer.answer, knockAnswer.name) }}</span>
				<div class="office__knock-actions">
					<NcButton v-if="knockAnswer.link" variant="primary" @click="openLink(knockAnswer.link); knockAnswer = null">
						{{ t('virtualoffice', 'Call') }}
					</NcButton>
					<NcButton variant="tertiary" @click="knockAnswer = null">
						{{ t('virtualoffice', 'Dismiss') }}
					</NcButton>
				</div>
			</div>

			<div class="office__toast" role="status" aria-live="polite">
				<span v-if="feedback">{{ feedback }}</span>
			</div>
			<div class="hidden-visually" aria-live="polite">
				{{ liveText }}
			</div>

			<AppearancePicker
				v-if="showAppearance"
				:appearance="appearance"
				:saving="savingAppearance"
				@close="showAppearance = false"
				@save="saveAppearance" />
			<OfficeSettingsDialog
				v-if="showSettings"
				:office="office"
				@close="showSettings = false"
				@updated="(updated) => office = { ...updated, count: office?.count ?? null }"
				@deleted="goToDirectory" />
		</template>
	</main>
</template>

<style scoped>
.office {
	min-height: 100%;
	padding: calc(var(--default-grid-baseline) * 4);
	padding-inline-start: max(calc(var(--default-grid-baseline) * 4), var(--app-navigation-padding, 0px));
}

.office__loading {
	margin-top: 80px;
}

.landing {
	max-width: 820px;
	margin: 24px auto;
}

.landing__back {
	display: inline-flex;
	align-items: center;
	gap: 4px;
	margin-bottom: 12px;
	color: var(--color-text-maxcontrast);
}

.landing__card {
	display: flex;
	flex-wrap: wrap;
	gap: 28px;
	padding: 28px;
	border-radius: var(--border-radius-container-large, 16px);
	background: var(--color-background-hover);
}

.landing__art {
	position: relative;
	display: grid;
	place-items: center;
	width: 280px;
	height: 180px;
	border-radius: 16px;
	background: #0e3552;
	overflow: hidden;
}

.landing__preview {
	width: 100%;
	height: 100%;
	object-fit: cover;
}

.landing__character {
	position: absolute;
	right: 8px;
	bottom: 8px;
	display: grid;
	place-items: center;
	width: 64px;
	height: 66px;
	border-radius: 12px;
	background: var(--color-main-background);
	box-shadow: 0 2px 8px #153d5a66;
}

.landing__text {
	display: flex;
	flex: 1;
	flex-direction: column;
	gap: 12px;
	min-width: 260px;
}

.landing__text h2 {
	margin: 0;
}

.room__call, .call-line {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 8px;
	color: var(--color-success-text);
	font-weight: 600;
}

.room__call {
	margin-bottom: 12px;
	padding: 8px 12px;
	border-radius: var(--border-radius-large, 10px);
	background: var(--color-success-hover, #e8f5e9);
	color: var(--color-main-text);
}

.landing__meta, .room__meta {
	color: var(--color-text-maxcontrast);
}

.office__knock {
	position: fixed;
	z-index: 10010;
	right: 20px;
	bottom: 20px;
	display: flex;
	flex-direction: column;
	gap: 10px;
	max-width: 360px;
	padding: 14px 16px;
	border-radius: var(--border-radius-large);
	background: var(--color-main-background);
	box-shadow: 0 4px 18px #00000040;
	font-weight: 600;
}

.office__knock-actions {
	display: flex;
	flex-wrap: wrap;
	gap: 6px;
}

.landing__team a {
	font-weight: 600;
	text-decoration: underline;
}

.landing__extras {
	margin-top: 16px;
}

.landing__today {
	max-width: 420px;
	margin-bottom: 8px;
}

.landing__actions {
	display: flex;
	flex-wrap: wrap;
	gap: 8px;
}

.room__header {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	justify-content: space-between;
	gap: 12px;
	margin-bottom: 12px;
}

.room__title h2 {
	margin: 0;
}

.room__header-actions, .room__view {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 6px;
}

.room__body {
	display: grid;
	grid-template-columns: minmax(0, 1fr) 320px;
	gap: 16px;
	align-items: start;
}

.room__body--list {
	grid-template-columns: minmax(0, 640px);
	justify-content: center;
}

.room__panel {
	display: flex;
	flex-direction: column;
	gap: 12px;
}

.controls {
	display: flex;
	flex-direction: column;
	gap: 10px;
	padding: 12px;
	border-radius: var(--border-radius-container-large, 16px);
	background: var(--color-background-hover);
}

.controls__you, .controls__group {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 6px;
}

.office__toast {
	position: fixed;
	bottom: 24px;
	left: 50%;
	transform: translateX(-50%);
	z-index: 1000;
	pointer-events: none;
}

.office__toast span {
	display: block;
	padding: 10px 18px;
	border-radius: 999px;
	background: var(--color-main-text);
	color: var(--color-main-background);
	box-shadow: 0 4px 12px #0003;
}

@media (max-width: 1024px) {
	.room__body {
		grid-template-columns: minmax(0, 1fr);
	}
}
</style>
