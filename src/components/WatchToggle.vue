<!--
  - SPDX-FileCopyrightText: 2026 Hoang Pham
  - SPDX-License-Identifier: AGPL-3.0-or-later
-->
<script setup lang="ts">
import { t } from '@nextcloud/l10n'
import { onMounted, ref } from 'vue'
import NcCheckboxRadioSwitch from '@nextcloud/vue/components/NcCheckboxRadioSwitch'
import { api } from '../api.ts'

const props = defineProps<{ token: string }>()

const watching = ref(false)
const loaded = ref(false)

/** Until the end of the person's own day. */
function endOfDay(): number {
	const end = new Date()
	end.setHours(23, 59, 59, 999)
	return end.getTime()
}

async function toggle(value: boolean) {
	watching.value = value
	try {
		watching.value = (value ? await api.watch(props.token, endOfDay()) : await api.unwatch(props.token)).watching
	} catch {
		watching.value = !value
	}
}

onMounted(async () => {
	try {
		watching.value = (await api.watching(props.token)).watching
		loaded.value = true
	} catch {
		// Not available to this person; the switch stays hidden.
	}
})
</script>

<template>
	<NcCheckboxRadioSwitch
		v-if="loaded"
		:modelValue="watching"
		type="switch"
		@update:modelValue="toggle">
		{{ t('virtualoffice', 'Tell me when someone arrives') }}
	</NcCheckboxRadioSwitch>
</template>
