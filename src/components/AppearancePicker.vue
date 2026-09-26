<!--
  - SPDX-FileCopyrightText: 2026 Hoang Pham
  - SPDX-License-Identifier: AGPL-3.0-or-later
-->
<script setup lang="ts">
import type { Appearance } from '../../shared/catalog.ts'

import { t } from '@nextcloud/l10n'
import { ref } from 'vue'
import NcButton from '@nextcloud/vue/components/NcButton'
import NcDialog from '@nextcloud/vue/components/NcDialog'
import CreaturePreview from './CreaturePreview.vue'
import { catalog } from '../../shared/catalog.ts'
import { accessoryLabel, creatureLabel, paletteLabel } from '../labels.ts'

const props = defineProps<{ appearance: Appearance, saving: boolean }>()
const emit = defineEmits<{ close: [], save: [appearance: Appearance] }>()
const draft = ref<Appearance>({ ...props.appearance })
</script>

<template>
	<NcDialog
		:name="t('virtualoffice', 'Your character')"
		:open="true"
		size="normal"
		@update:open="(open) => !open && emit('close')">
		<div class="picker">
			<div class="picker__preview" aria-hidden="true">
				<CreaturePreview :appearance="draft" :size="96" />
				<CreaturePreview :appearance="draft" facing="east" :size="96" />
			</div>
			<fieldset>
				<legend>{{ t('virtualoffice', 'Creature') }}</legend>
				<div class="picker__choices">
					<label
						v-for="creature in catalog.creatures"
						:key="creature"
						class="choice"
						:class="{ 'choice--selected': draft.creature === creature }">
						<input
							v-model="draft.creature"
							type="radio"
							name="creature"
							:value="creature"
							class="hidden-visually">
						<CreaturePreview :appearance="{ ...draft, creature }" :size="44" />
						<span>{{ creatureLabel(creature) }}</span>
					</label>
				</div>
			</fieldset>
			<fieldset>
				<legend>{{ t('virtualoffice', 'Color') }}</legend>
				<div class="picker__choices">
					<label
						v-for="palette in catalog.palettes"
						:key="palette.id"
						class="choice choice--small"
						:class="{ 'choice--selected': draft.palette === palette.id }">
						<input
							v-model="draft.palette"
							type="radio"
							name="palette"
							:value="palette.id"
							class="hidden-visually">
						<span class="swatch" :style="{ background: palette.body, borderColor: palette.belly }" />
						<span>{{ paletteLabel(palette.id) }}</span>
					</label>
				</div>
			</fieldset>
			<fieldset>
				<legend>{{ t('virtualoffice', 'Accessory') }}</legend>
				<div class="picker__choices">
					<label
						v-for="accessory in catalog.accessories"
						:key="accessory"
						class="choice choice--small"
						:class="{ 'choice--selected': draft.accessory === accessory }">
						<input
							v-model="draft.accessory"
							type="radio"
							name="accessory"
							:value="accessory"
							class="hidden-visually">
						<span>{{ accessoryLabel(accessory) }}</span>
					</label>
				</div>
			</fieldset>
		</div>
		<template #actions>
			<NcButton @click="emit('close')">
				{{ t('virtualoffice', 'Cancel') }}
			</NcButton>
			<NcButton variant="primary" :disabled="saving" @click="emit('save', draft)">
				{{ saving ? t('virtualoffice', 'Saving…') : t('virtualoffice', 'Save') }}
			</NcButton>
		</template>
	</NcDialog>
</template>

<style scoped>
.picker {
	display: flex;
	flex-direction: column;
	gap: 12px;
}

.picker__preview {
	display: flex;
	justify-content: center;
	gap: 24px;
	padding: 12px;
	border-radius: 16px;
	background: var(--color-primary-element-light);
}

fieldset legend {
	margin-bottom: 6px;
	font-weight: 700;
}

.picker__choices {
	display: flex;
	flex-wrap: wrap;
	gap: 8px;
}

.choice {
	display: flex;
	flex-direction: column;
	align-items: center;
	gap: 4px;
	min-width: 72px;
	min-height: 44px;
	padding: 8px;
	border: 2px solid var(--color-border);
	border-radius: 12px;
	cursor: pointer;
}

.choice--small {
	flex-direction: row;
	min-width: 0;
	padding: 6px 12px;
}

.choice--selected {
	border-color: var(--color-primary-element);
	background: var(--color-primary-element-light);
}

.choice:focus-within {
	outline: 2px solid var(--color-primary-element);
	outline-offset: 2px;
}

.swatch {
	width: 18px;
	height: 18px;
	border: 3px solid;
	border-radius: 50%;
}
</style>
