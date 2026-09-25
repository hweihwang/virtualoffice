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

const available = ref(false)
const joined = ref(false)

async function toggle(value: boolean) {
	joined.value = value
	try {
		joined.value = (value ? await api.joinRoulette(props.token) : await api.leaveRoulette(props.token)).joined
	} catch {
		joined.value = !value
	}
}

onMounted(async () => {
	try {
		const state = await api.roulette(props.token)
		available.value = state.available
		joined.value = state.joined
	} catch {
		// Not available to this person; the switch stays hidden.
	}
})
</script>

<template>
	<NcCheckboxRadioSwitch
		v-if="available"
		:modelValue="joined"
		type="switch"
		@update:modelValue="toggle">
		{{ t('virtualoffice', 'Coffee roulette: meet someone new each week') }}
	</NcCheckboxRadioSwitch>
</template>
