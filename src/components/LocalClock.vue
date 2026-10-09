<!--
  - SPDX-FileCopyrightText: 2026 Hoang Pham
  - SPDX-License-Identifier: AGPL-3.0-or-later
-->
<script setup lang="ts">
import type { TimeInfo } from '../types.ts'

import { mdiWeatherNight } from '@mdi/js'
import { getCanonicalLocale, t } from '@nextcloud/l10n'
import { computed } from 'vue'
import NcIconSvgWrapper from '@nextcloud/vue/components/NcIconSvgWrapper'
import { clockOf } from '../session/time.ts'

const props = defineProps<{ info?: TimeInfo, now: number }>()
const clock = computed(() => clockOf(props.info, props.now, getCanonicalLocale()))
</script>

<template>
	<span v-if="clock" class="clock" :title="clock.off ? t('virtualoffice', 'Outside working hours') : undefined">
		{{ clock.time }}
		<NcIconSvgWrapper
			v-if="clock.off"
			class="clock__night"
			:path="mdiWeatherNight"
			:size="14"
			inline
			:name="t('virtualoffice', 'Outside working hours')" />
	</span>
</template>

<style scoped>
.clock {
	white-space: nowrap;
}

.clock__night {
	vertical-align: -2px;
}
</style>
