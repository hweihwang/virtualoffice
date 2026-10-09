<!--
  - SPDX-FileCopyrightText: 2026 Hoang Pham
  - SPDX-License-Identifier: AGPL-3.0-or-later
-->
<script setup lang="ts">
import type { RoomSession } from '../session/room.ts'

import { getCanonicalLocale, t } from '@nextcloud/l10n'
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { statusLabel, zoneLabels } from '../labels.ts'
import { SceneRenderer } from '../scene/renderer.ts'
import { clockOf } from '../session/time.ts'

import '../scene/scene.css'

const props = withDefaults(defineProps<{ session: RoomSession, reducedEffects: boolean, speaking?: string[] }>(), { speaking: () => [] })
const emit = defineEmits<{ blocked: [] }>()
const root = ref<HTMLElement | null>(null)
let renderer: SceneRenderer | null = null
const media = window.matchMedia('(prefers-reduced-motion: reduce)')

function onVisibility() {
	if (document.hidden) {
		renderer?.stop()
	} else {
		renderer?.start()
	}
}

onMounted(() => {
	renderer = new SceneRenderer(root.value!, props.session, {
		zoneLabels: zoneLabels(),
		youName: (name: string) => t('virtualoffice', '{name} (you)', { name }),
		statusLabel,
		reducedMotion: () => props.reducedEffects || media.matches,
		speaking: (uid: string) => props.speaking.includes(uid),
		voiceLabel: t('virtualoffice', 'Voice on'),
		clockLabel: (uid: string) => {
			const clock = clockOf(props.session.state.times[uid], props.session.clock.serverNow(), getCanonicalLocale())
			if (!clock) {
				return ''
			}
			return clock.off ? t('virtualoffice', '{time}, outside working hours', { time: clock.time }) : clock.time
		},
		onPropBlocked: () => emit('blocked'),
	})
	renderer.start()
	document.addEventListener('visibilitychange', onVisibility)
})

watch(() => props.session.state.decor, (decor) => renderer?.setDecor(decor))

onBeforeUnmount(() => {
	document.removeEventListener('visibilitychange', onVisibility)
	renderer?.destroy()
	renderer = null
})

defineExpose({
	focus: () => root.value?.focus(),
	walkNextTo: (uid: string) => renderer?.walkNextTo(uid),
})
</script>

<template>
	<div
		ref="root"
		class="office-scene"
		tabindex="0"
		role="application"
		:aria-label="t('virtualoffice', 'Office map')"
		aria-describedby="vo-scene-help">
		<p id="vo-scene-help" class="hidden-visually">
			{{ t('virtualoffice', 'Click or tap a spot to walk there. With the map focused, use the arrow keys or W A S D to walk, Enter to use the coffee machine or plant when next to it, 1 to 4 for reactions and Escape to move focus off the map. Everything is also available in the people and places list.') }}
		</p>
	</div>
</template>
