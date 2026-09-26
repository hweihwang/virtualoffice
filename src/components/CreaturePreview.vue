<!--
  - SPDX-FileCopyrightText: 2026 Hoang Pham
  - SPDX-License-Identifier: AGPL-3.0-or-later
-->
<script setup lang="ts">
import type { Appearance } from '../../shared/catalog.ts'
import type { Facing } from '../scene/sprites.ts'

import { computed } from 'vue'
import { creatureSvg } from '../scene/sprites.ts'

const props = withDefaults(defineProps<{ appearance: Appearance, facing?: Facing, size?: number }>(), { facing: 'south', size: 72 })
// Generated from catalog values only, never from user text.
const svg = computed(() => creatureSvg(props.appearance, props.facing))
</script>

<template>
	<!-- eslint-disable-next-line vue/no-v-html -- SVG is generated from catalog values only -->
	<span class="creature-preview" :style="{ width: `${size}px`, height: `${size * 56 / 48}px` }" v-html="svg" />
</template>

<style scoped>
.creature-preview {
	display: inline-block;
	flex: none;
}

.creature-preview :deep(svg) {
	width: 100%;
	height: 100%;
}
</style>
