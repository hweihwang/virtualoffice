<!--
  - SPDX-FileCopyrightText: 2026 Hoang Pham
  - SPDX-License-Identifier: AGPL-3.0-or-later
-->
<script setup lang="ts">
import type { Preferences } from '../types.ts'

import { t } from '@nextcloud/l10n'
import { ref } from 'vue'
import NcCheckboxRadioSwitch from '@nextcloud/vue/components/NcCheckboxRadioSwitch'
import NcDialog from '@nextcloud/vue/components/NcDialog'
import { unlockAudio } from '../session/audio.ts'

const props = defineProps<{ preferences: Preferences, voiceAllowed: boolean }>()
const emit = defineEmits<{ change: [change: Partial<Preferences['ui']>], close: [] }>()

const musicVolume = ref(props.preferences.ui.musicVolume ?? 50)
const voiceVolume = ref(props.preferences.ui.voiceVolume ?? 100)
const voiceMode = ref(props.preferences.ui.voiceMode ?? 'push')

/** Saved when the slider is let go; moving it also lets the browser play sound. */
function save(change: Partial<Preferences['ui']>) {
	unlockAudio()
	emit('change', change)
}

const percent = (value: number) => value === 0 ? t('virtualoffice', 'Off') : `${value} %`
</script>

<template>
	<NcDialog
		:name="t('virtualoffice', 'Sound')"
		:open="true"
		size="small"
		@update:open="(open) => !open && emit('close')">
		<div class="sound">
			<label class="sound__slider">
				<span>{{ t('virtualoffice', 'Music volume') }} <output>{{ percent(musicVolume) }}</output></span>
				<input
					v-model.number="musicVolume"
					type="range"
					min="0"
					max="100"
					step="5"
					@change="save({ musicVolume })">
			</label>
			<template v-if="voiceAllowed">
				<label class="sound__slider">
					<span>{{ t('virtualoffice', 'Voice volume') }} <output>{{ percent(voiceVolume) }}</output></span>
					<input
						v-model.number="voiceVolume"
						type="range"
						min="0"
						max="100"
						step="5"
						@change="save({ voiceVolume })">
				</label>
				<fieldset>
					<legend>{{ t('virtualoffice', 'Voice') }}</legend>
					<NcCheckboxRadioSwitch
						v-model="voiceMode"
						type="radio"
						value="push"
						name="voice-mode"
						@update:modelValue="save({ voiceMode: 'push' })">
						{{ t('virtualoffice', 'Push to talk: hold V or the Talk button') }}
					</NcCheckboxRadioSwitch>
					<NcCheckboxRadioSwitch
						v-model="voiceMode"
						type="radio"
						value="open"
						name="voice-mode"
						@update:modelValue="save({ voiceMode: 'open' })">
						{{ t('virtualoffice', 'Open mic: press M to mute') }}
					</NcCheckboxRadioSwitch>
				</fieldset>
			</template>
		</div>
	</NcDialog>
</template>

<style scoped>
.sound {
	display: flex;
	flex-direction: column;
	gap: 16px;
	padding-bottom: 12px;
}

.sound__slider {
	display: flex;
	flex-direction: column;
	gap: 4px;
}

.sound__slider span {
	display: flex;
	justify-content: space-between;
	font-weight: 600;
}

.sound__slider output {
	color: var(--color-text-maxcontrast);
	font-weight: 400;
}

.sound__slider input {
	width: 100%;
	min-height: 44px;
	accent-color: var(--color-primary-element);
}

fieldset legend {
	margin-bottom: 4px;
	font-weight: 600;
}
</style>
