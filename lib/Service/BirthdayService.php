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
		private TimeService $time,
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

	/** Whether "MM-DD" is today where the person is, by the server's zone when they set none. */
	public function isToday(string $uid, ?string $monthDay, int $nowMs): bool {
		if ($monthDay === null) {
			return false;
		}
		$zone = $this->time->timeZone($uid);
		$now = (new \DateTimeImmutable('@' . intdiv($nowMs, 1000)))->setTimezone(new \DateTimeZone($zone ?? date_default_timezone_get()));
		return $monthDay === $now->format('m-d');
	}
}
