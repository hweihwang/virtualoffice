<!--
  - SPDX-FileCopyrightText: 2026 Hoang Pham
  - SPDX-License-Identifier: AGPL-3.0-or-later
-->
<script setup lang="ts">
import { t } from '@nextcloud/l10n'
import { onMounted, ref } from 'vue'
import NcTextField from '@nextcloud/vue/components/NcTextField'
import { api } from '../api.ts'

const emit = defineEmits<{ feedback: [text: string] }>()

/** Matches the server limit. */
const MAX_LENGTH = 80

const text = ref('')
let saved = ''

/** Notes last until the end of the person's own day. */
function endOfDay(): number {
	const end = new Date()
	end.setHours(23, 59, 59, 999)
	return end.getTime()
}

async function save() {
	const value = text.value.trim()
	if (value === saved) {
		return
	}
	try {
		const result = await api.setToday(value, endOfDay())
		saved = result.today?.text ?? ''
		text.value = saved
		emit('feedback', saved ? t('virtualoffice', 'Others can now see what you are working on today') : t('virtualoffice', 'Note removed'))
	} catch {
		emit('feedback', t('virtualoffice', 'Could not save the note'))
	}
}

onMounted(async () => {
	try {
		saved = (await api.today()).today?.text ?? ''
		// Keep what the person already started typing.
		if (text.value === '') {
			text.value = saved
		}
	} catch {
		// Starts empty; saving still works.
	}
})
</script>

<template>
	<NcTextField
		v-model="text"
		class="today"
		:label="t('virtualoffice', 'Today')"
		:placeholder="t('virtualoffice', 'What are you working on today?')"
		:maxlength="MAX_LENGTH"
		:helperText="t('virtualoffice', 'Shown with your character and desk until the end of the day')"
		@keydown.enter.prevent="save"
		@blur="save" />
</template>
