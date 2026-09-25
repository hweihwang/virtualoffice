<!--
  - SPDX-FileCopyrightText: 2026 Hoang Pham
  - SPDX-License-Identifier: AGPL-3.0-or-later
-->
<script setup lang="ts">
import type { InitialConfig } from './types.ts'

import { loadState } from '@nextcloud/initial-state'
import NcAppContent from '@nextcloud/vue/components/NcAppContent'
import NcContent from '@nextcloud/vue/components/NcContent'
import ConversationDoor from './views/ConversationDoor.vue'
import DirectoryView from './views/DirectoryView.vue'
import OfficeView from './views/OfficeView.vue'

const config = loadState<InitialConfig>('virtualoffice', 'config')
</script>

<template>
	<NcContent appName="virtualoffice">
		<NcAppContent>
			<OfficeView v-if="config.view === 'office'" :config="config" />
			<ConversationDoor v-else-if="config.view === 'conversation'" :config="config" />
			<DirectoryView v-else :config="config" />
		</NcAppContent>
	</NcContent>
</template>
