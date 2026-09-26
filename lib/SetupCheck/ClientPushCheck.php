<?php

declare(strict_types=1);

/**
 * SPDX-FileCopyrightText: 2026 Hoang Pham
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

namespace OCA\VirtualOffice\SetupCheck;

use OCA\VirtualOffice\Service\PushService;
use OCP\IL10N;
use OCP\SetupCheck\ISetupCheck;
use OCP\SetupCheck\SetupResult;

/** Offices work without Client Push; this explains the difference to admins. */
class ClientPushCheck implements ISetupCheck {
	public function __construct(
		private PushService $push,
		private IL10N $l10n,
	) {
	}

	#[\Override]
	public function getCategory(): string {
		return 'system';
	}

	#[\Override]
	public function getName(): string {
		return $this->l10n->t('Virtual Office live updates');
	}

	#[\Override]
	public function run(): SetupResult {
		if ($this->push->isAvailable()) {
			return SetupResult::success($this->l10n->t('Movement is delivered instantly through Client Push.'));
		}
		return SetupResult::info($this->l10n->t('Offices work without Client Push, but browsers check for updates about once a second. Set up Client Push (notify_push) so movement appears instantly and busy offices put less load on the server.'));
	}
}
