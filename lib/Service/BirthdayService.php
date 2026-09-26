<?php

declare(strict_types=1);

/**
 * SPDX-FileCopyrightText: 2026 Hoang Pham
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

namespace OCA\VirtualOffice\Service;

use OCP\Accounts\IAccountManager;
use OCP\Accounts\PropertyDoesNotExistException;
use OCP\IUser;

/**
 * Birthdays from the profile, only when the person shares their birth date
 * beyond "private". Only month and day are used.
 */
class BirthdayService {
	/** @var array<string, ?string> */
	private array $cache = [];

	public function __construct(
		private IAccountManager $accounts,
	) {
	}

	/** "MM-DD", or null when unknown or private. */
	public function monthDay(IUser $user): ?string {
		$uid = $user->getUID();
		if (!array_key_exists($uid, $this->cache)) {
			$this->cache[$uid] = null;
			try {
				$property = $this->accounts->getAccount($user)->getProperty(IAccountManager::PROPERTY_BIRTHDATE);
				if ($property->getScope() !== IAccountManager::SCOPE_PRIVATE && preg_match('/^\d{4}-(\d{2})-(\d{2})$/', $property->getValue(), $m) === 1) {
					$this->cache[$uid] = $m[1] . '-' . $m[2];
				}
			} catch (PropertyDoesNotExistException) {
			}
		}
		return $this->cache[$uid];
	}

	/** Whether "MM-DD" is today, by the server's date. */
	public static function isToday(?string $monthDay, int $nowMs): bool {
		return $monthDay !== null && $monthDay === date('m-d', intdiv($nowMs, 1000));
	}
}
