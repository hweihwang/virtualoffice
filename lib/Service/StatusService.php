<?php

declare(strict_types=1);

/**
 * SPDX-FileCopyrightText: 2026 Hoang Pham
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

namespace OCA\VirtualOffice\Service;

use OCP\UserStatus\IManager;
use OCP\UserStatus\IUserStatus;

/**
 * Nextcloud user status as others already see it. Invisible and offline
 * people show no status, so the office never reveals more than the status
 * menu does.
 */
class StatusService {
	public function __construct(
		private IManager $statuses,
	) {
	}

	/**
	 * @param list<string> $uids
	 * @return array<string, array{status: string, message: ?string, icon: ?string, clearAt: ?int}>
	 */
	public function forUsers(array $uids): array {
		if ($uids === []) {
			return [];
		}
		$result = [];
		foreach ($this->statuses->getUserStatuses($uids) as $uid => $status) {
			if (!in_array($status->getStatus(), [IUserStatus::ONLINE, IUserStatus::AWAY, IUserStatus::DND, IUserStatus::BUSY], true)) {
				continue;
			}
			$result[(string)$uid] = [
				'status' => $status->getStatus(),
				'message' => $status->getMessage(),
				'icon' => $status->getIcon(),
				'clearAt' => $status->getClearAt()?->getTimestamp(),
			];
		}
		return $result;
	}
}
