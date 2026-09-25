<?php

declare(strict_types=1);

/**
 * SPDX-FileCopyrightText: 2026 Hoang Pham
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

namespace OCA\VirtualOffice\Settings;

use OCA\VirtualOffice\AppInfo\Application;
use OCA\VirtualOffice\Service\PushService;
use OCA\VirtualOffice\Service\Settings;
use OCP\AppFramework\Http\TemplateResponse;
use OCP\AppFramework\Services\IInitialState;
use OCP\Settings\ISettings;

class Admin implements ISettings {
	public function __construct(
		private Settings $settings,
		private PushService $push,
		private IInitialState $initialState,
	) {
	}

	#[\Override]
	public function getForm(): TemplateResponse {
		$this->initialState->provideInitialState('admin', $this->settings->toArray() + ['clientPush' => $this->push->isAvailable()]);
		return new TemplateResponse(Application::APP_ID, 'admin');
	}

	#[\Override]
	public function getSection(): string {
		return Application::APP_ID;
	}

	#[\Override]
	public function getPriority(): int {
		return 10;
	}
}
