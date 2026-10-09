<?php

declare(strict_types=1);

/**
 * SPDX-FileCopyrightText: 2026 Hoang Pham
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

namespace OCA\VirtualOffice\Service;

use OCA\VirtualOffice\AppInfo\Application;
use OCA\VirtualOffice\Db\Office;
use OCA\VirtualOffice\Db\OfficeMapper;
use OCA\VirtualOffice\Db\RouletteEntry;
use OCA\VirtualOffice\Db\RouletteMapper;
use OCA\VirtualOffice\Exception\ApiException;
use OCP\AppFramework\Db\DoesNotExistException;
use OCP\DB\Exception as DBException;
use OCP\IUser;
use OCP\IUserManager;
use OCP\Notification\IManager as INotificationManager;

/**
 * Coffee roulette for group offices and offices for everyone: once a week, people
 * who joined are paired at random for a short chat, across the teams they
 * would not meet otherwise. Joining is voluntary and can be undone any time.
 */
class RouletteService {
	public const KINDS = [AccessPolicy::KIND_GROUP, AccessPolicy::KIND_INSTANCE];

	public function __construct(
		private RouletteMapper $entries,
		private OfficeMapper $offices,
		private AccessPolicy $accessPolicy,
		private IUserManager $userManager,
		private INotificationManager $notifications,
		private Clock $clock,
		private TimeService $time,
	) {
	}

	/**
	 * @return array{available: bool, joined: bool}
	 * @throws ApiException
	 */
	public function get(IUser $user, Office $office): array {
		$this->accessPolicy->assertCanEnter($user, $office);
		return [
			'available' => in_array($office->getAudienceKind(), self::KINDS, true),
			'joined' => $this->entries->findFor($office->getId(), RoomService::uidKey($user->getUID())) !== null,
		];
	}

	/** @throws ApiException */
	public function join(IUser $user, Office $office): array {
		$this->accessPolicy->assertCanEnter($user, $office);
		if (!in_array($office->getAudienceKind(), self::KINDS, true)) {
			throw ApiException::invalid('Coffee roulette is for group offices and offices for everyone');
		}
		$uidKey = RoomService::uidKey($user->getUID());
		if ($this->entries->findFor($office->getId(), $uidKey) === null) {
			$entry = new RouletteEntry();
			$entry->setOfficeId($office->getId());
			$entry->setUid($user->getUID());
			$entry->setUidKey($uidKey);
			try {
				$this->entries->insert($entry);
			} catch (DBException $e) {
				if ($e->getReason() !== DBException::REASON_UNIQUE_CONSTRAINT_VIOLATION) {
					throw $e;
				}
			}
		}
		return ['available' => true, 'joined' => true];
	}

	/** @throws ApiException */
	public function leave(IUser $user, Office $office): array {
		$this->accessPolicy->assertVisible($user, $office);
		$this->entries->deleteFor($office->getId(), RoomService::uidKey($user->getUID()));
		return ['available' => in_array($office->getAudienceKind(), self::KINDS, true), 'joined' => false];
	}

	/** Pairs every office where at least two people joined. */
	public function pairAll(): int {
		$pairs = 0;
		foreach ($this->entries->findOfficesToPair() as $officeId) {
			try {
				$pairs += count($this->pairOffice($this->offices->findById($officeId)));
			} catch (DoesNotExistException) {
				$this->entries->deleteByOffice($officeId);
			}
		}
		return $pairs;
	}

	/**
	 * Pairs the people who joined, still belong to the audience and are not
	 * removed for now. Each person in shuffled order gets the partner with
	 * whom they share the most working hours in the coming week, so people in
	 * far apart time zones still find a time to talk. Last week's partner is
	 * avoided when possible, and equal choices keep the shuffled order. With
	 * an odd number, one person waits for next week.
	 *
	 * @param ?callable(list<RouletteEntry>): list<RouletteEntry> $shuffle
	 * @return list<array{0: string, 1: string}>
	 */
	public function pairOffice(Office $office, ?callable $shuffle = null): array {
		$pool = [];
		foreach ($this->entries->findByOffice($office->getId()) as $entry) {
			$user = $this->userManager->get($entry->getUid());
			try {
				if ($user === null || !$this->accessPolicy->isMember($user, $office)) {
					// Left the group or the offices for everyone were turned off.
					$this->entries->deleteFor($office->getId(), $entry->getUidKey());
				} elseif ($this->accessPolicy->isWelcome($user, $office)) {
					$pool[] = $entry;
				}
			} catch (ApiException) {
				// The audience cannot be checked now; nobody is paired blindly.
				return [];
			}
		}
		if ($shuffle !== null) {
			$pool = $shuffle($pool);
		} else {
			shuffle($pool);
		}
		$now = $this->clock->nowMs();
		$hours = $this->time->forUsers(array_map(static fn (RouletteEntry $e) => $e->getUid(), $pool));
		$pairs = [];
		while (count($pool) >= 2) {
			$first = array_shift($pool);
			$index = null;
			$best = -1;
			foreach ($pool as $i => $candidate) {
				if ($candidate->getUidKey() === $first->getLastPartnerKey()) {
					continue;
				}
				$shared = TimeService::sharedMinutes($hours[$first->getUid()]['hours'], $hours[$candidate->getUid()]['hours'], $now);
				if ($shared > $best) {
					$best = $shared;
					$index = $i;
				}
			}
			$index ??= 0;
			/** @var RouletteEntry $second */
			[$second] = array_splice($pool, $index, 1);
			$first->setLastPartnerKey($second->getUidKey());
			$second->setLastPartnerKey($first->getUidKey());
			$this->entries->update($first);
			$this->entries->update($second);
			$this->notify($office, $first->getUid(), $second->getUid());
			$this->notify($office, $second->getUid(), $first->getUid());
			$pairs[] = [$first->getUid(), $second->getUid()];
		}
		return $pairs;
	}

	public function forgetOffice(int $officeId): void {
		$this->entries->deleteByOffice($officeId);
	}

	public function forgetUser(string $uid): void {
		$this->entries->deleteByUidKey(RoomService::uidKey($uid));
	}

	private function notify(Office $office, string $uid, string $partner): void {
		$notification = $this->notifications->createNotification();
		$notification->setApp(Application::APP_ID)
			->setUser($uid)
			->setDateTime(new \DateTime('@' . intdiv($this->clock->nowMs(), 1000)))
			->setObject('pair', $office->getToken())
			->setSubject('pair', ['office' => $office->getToken(), 'from' => $partner]);
		$this->notifications->notify($notification);
	}
}
