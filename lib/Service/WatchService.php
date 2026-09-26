<?php

declare(strict_types=1);

/**
 * SPDX-FileCopyrightText: 2026 Hoang Pham
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

namespace OCA\VirtualOffice\Service;

use OCA\VirtualOffice\AppInfo\Application;
use OCA\VirtualOffice\Db\Office;
use OCA\VirtualOffice\Db\PresenceMapper;
use OCA\VirtualOffice\Db\Watch;
use OCA\VirtualOffice\Db\WatchMapper;
use OCA\VirtualOffice\Exception\ApiException;
use OCP\DB\Exception as DBException;
use OCP\IUser;
use OCP\IUserManager;
use OCP\Notification\IManager as INotificationManager;

/**
 * "Tell me when someone arrives": one notification when the next person
 * enters the office, then the request is gone. It also ends at the given
 * time, usually the end of the person's day.
 */
class WatchService {
	private const MAX_MS = 86_400_000;

	public function __construct(
		private WatchMapper $watches,
		private PresenceMapper $presences,
		private AccessPolicy $accessPolicy,
		private IUserManager $userManager,
		private INotificationManager $notifications,
		private Clock $clock,
	) {
	}

	/**
	 * @return array{watching: bool, expiresAt: ?int}
	 * @throws ApiException
	 */
	public function get(IUser $user, Office $office): array {
		$this->accessPolicy->assertCanEnter($user, $office);
		$watch = $this->watches->findFor($office->getId(), RoomService::uidKey($user->getUID()));
		$active = $watch !== null && $watch->getExpiresAt() > $this->clock->nowMs();
		return ['watching' => $active, 'expiresAt' => $active ? $watch->getExpiresAt() : null];
	}

	/**
	 * @return array{watching: bool, expiresAt: ?int}
	 * @throws ApiException
	 */
	public function set(IUser $user, Office $office, mixed $expiresAt): array {
		$this->accessPolicy->assertCanEnter($user, $office);
		if (!is_int($expiresAt)) {
			throw ApiException::invalid('Invalid expiry');
		}
		$now = $this->clock->nowMs();
		$uidKey = RoomService::uidKey($user->getUID());
		$watch = $this->watches->findFor($office->getId(), $uidKey) ?? new Watch();
		$watch->setOfficeId($office->getId());
		$watch->setUid($user->getUID());
		$watch->setUidKey($uidKey);
		$watch->setExpiresAt(max($now + 60_000, min($expiresAt, $now + self::MAX_MS)));
		try {
			$watch->getId() === null ? $this->watches->insert($watch) : $this->watches->update($watch);
		} catch (DBException $e) {
			// Another window asked at the same time; one request is enough.
			if ($e->getReason() !== DBException::REASON_UNIQUE_CONSTRAINT_VIOLATION) {
				throw $e;
			}
		}
		return ['watching' => true, 'expiresAt' => $watch->getExpiresAt()];
	}

	/** @return array{watching: false, expiresAt: null} */
	public function clear(IUser $user, Office $office): array {
		$this->accessPolicy->assertVisible($user, $office);
		$this->watches->deleteFor($office->getId(), RoomService::uidKey($user->getUID()));
		return ['watching' => false, 'expiresAt' => null];
	}

	/**
	 * Someone entered: tells each watcher who still belongs to the audience,
	 * is not removed for now and is not inside, once.
	 */
	public function arrived(Office $office, IUser $user): void {
		$now = $this->clock->nowMs();
		$this->watches->deleteFor($office->getId(), RoomService::uidKey($user->getUID()));
		foreach ($this->watches->findActiveByOffice($office->getId(), $now) as $watch) {
			$this->watches->delete($watch);
			$watcher = $this->userManager->get($watch->getUid());
			try {
				if ($watcher === null || !$this->accessPolicy->isWelcome($watcher, $office)) {
					continue;
				}
			} catch (ApiException) {
				continue;
			}
			$presence = $this->presences->findByUidKey($watch->getUidKey());
			if ($presence !== null && $presence->getOfficeId() === $office->getId() && $presence->getLeaseUntil() >= $now) {
				continue;
			}
			$notification = $this->notifications->createNotification();
			$notification->setApp(Application::APP_ID)
				->setUser($watch->getUid())
				->setDateTime(new \DateTime('@' . intdiv($now, 1000)))
				->setObject('arrival', $office->getToken())
				->setSubject('arrival', ['office' => $office->getToken(), 'from' => $user->getUID()]);
			$this->notifications->notify($notification);
		}
	}

	public function expire(): int {
		return $this->watches->deleteExpired($this->clock->nowMs());
	}

	public function forgetOffice(int $officeId): void {
		$this->watches->deleteByOffice($officeId);
	}

	public function forgetUser(string $uid): void {
		$this->watches->deleteByUidKey(RoomService::uidKey($uid));
	}
}
