<?php

declare(strict_types=1);

/**
 * SPDX-FileCopyrightText: 2026 Hoang Pham
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

namespace OCA\VirtualOffice\Service;

use OCA\VirtualOffice\Db\Desk;
use OCA\VirtualOffice\Db\DeskMapper;
use OCA\VirtualOffice\Db\Office;
use OCA\VirtualOffice\Db\PresenceMapper;
use OCA\VirtualOffice\Exception\ApiException;
use OCP\AppFramework\Db\TTransactional;
use OCP\AppFramework\Http;
use OCP\DB\Exception as DBException;
use OCP\IDBConnection;
use OCP\IUser;
use OCP\IUserManager;

/**
 * Desks people claim in an office. An owned desk shows the owner's name,
 * "Today" note and Nextcloud status while they are not inside, so the office
 * does not look empty. Owners who left the audience lose their desk.
 */
class DeskService {
	use TTransactional;

	/** How long an owner's access check is trusted. */
	public const AUTHORIZATION_MS = 60_000;

	public function __construct(
		private IDBConnection $db,
		private DeskMapper $desks,
		private PresenceMapper $presences,
		private AccessPolicy $accessPolicy,
		private IUserManager $userManager,
		private PreferenceService $preferences,
		private StatusService $statuses,
		private RoomService $room,
		private Catalog $catalog,
		private Clock $clock,
		private BirthdayService $birthdays,
	) {
	}

	/**
	 * Desks with their owners, and the status of owners and people inside.
	 *
	 * @return array{desks: list<array{deskId: string, uid: string, name: string, note: ?string, birthday: bool}>, statuses: array<string, array{status: string, message: ?string, icon: ?string, clearAt: ?int}>}
	 * @throws ApiException
	 */
	public function list(IUser $user, Office $office): array {
		$this->accessPolicy->assertCanEnter($user, $office);
		$now = $this->clock->nowMs();
		$desks = [];
		foreach ($this->desks->findByOffice($office->getId()) as $desk) {
			// A temporary removal hides the desk without freeing it.
			if ($this->isKept($desk, $office, $now) && $this->accessPolicy->removedUntil($office, $desk->getUid()) === null) {
				$owner = $this->userManager->get($desk->getUid());
				$desks[] = [
					'deskId' => $desk->getDeskId(),
					'uid' => $desk->getUid(),
					'name' => $this->userManager->getDisplayName($desk->getUid()) ?? $desk->getUid(),
					'note' => $this->preferences->today($desk->getUid(), $now)['text'] ?? null,
					'birthday' => $owner !== null && BirthdayService::isToday($this->birthdays->monthDay($owner), $now),
				];
			}
		}
		$uids = array_column($desks, 'uid');
		foreach ($this->presences->findByOffice($office->getId()) as $row) {
			if ($row->getLeaseUntil() >= $now) {
				$uids[] = $row->getUid();
			}
		}
		return ['desks' => $desks, 'statuses' => $this->statuses->forUsers(array_values(array_unique($uids)))];
	}

	/**
	 * Claims a free desk, giving up the user's previous desk in this office.
	 *
	 * @throws ApiException
	 */
	public function claim(IUser $user, Office $office, mixed $deskId): array {
		$this->accessPolicy->assertCanEnter($user, $office);
		if (!is_string($deskId) || !in_array($deskId, $this->catalog->deskIds($this->catalog->layout($office->getLayoutId())), true)) {
			throw ApiException::invalid('Unknown desk');
		}
		$uidKey = RoomService::uidKey($user->getUID());
		$now = $this->clock->nowMs();
		try {
			$changed = $this->atomic(function () use ($office, $deskId, $user, $uidKey, $now): bool {
				foreach ($this->desks->findByOffice($office->getId()) as $desk) {
					if ($desk->getDeskId() !== $deskId) {
						continue;
					}
					if ($desk->getUidKey() === $uidKey) {
						return false;
					}
					if ($this->isKept($desk, $office, $now)) {
						throw new ApiException('DESK_TAKEN', Http::STATUS_CONFLICT, 'Someone else has this desk');
					}
				}
				$this->desks->deleteFor($office->getId(), $uidKey);
				$desk = new Desk();
				$desk->setOfficeId($office->getId());
				$desk->setDeskId($deskId);
				$desk->setUid($user->getUID());
				$desk->setUidKey($uidKey);
				$desk->setClaimedAt($now);
				$desk->setAuthorizedUntil($now + self::AUTHORIZATION_MS);
				$this->desks->insert($desk);
				return true;
			}, $this->db);
		} catch (DBException $e) {
			if ($e->getReason() !== DBException::REASON_UNIQUE_CONSTRAINT_VIOLATION) {
				throw $e;
			}
			throw new ApiException('DESK_TAKEN', Http::STATUS_CONFLICT, 'Someone else has this desk');
		}
		if ($changed) {
			$this->room->announceDesks($office);
		}
		return $this->list($user, $office);
	}

	/**
	 * Frees a desk. Owners free their own; managers free any.
	 *
	 * @throws ApiException
	 */
	public function release(IUser $user, Office $office, string $deskId): array {
		$this->accessPolicy->assertVisible($user, $office);
		foreach ($this->desks->findByOffice($office->getId()) as $desk) {
			if ($desk->getDeskId() !== $deskId) {
				continue;
			}
			if ($desk->getUid() !== $user->getUID() && !$this->accessPolicy->canManage($user, $office)) {
				throw ApiException::denied();
			}
			$this->desks->delete($desk);
			$this->room->announceDesks($office);
		}
		return $this->list($user, $office);
	}

	/**
	 * Whether the owner still belongs to the audience, checked at most once a
	 * minute. Desks of people who left are freed; a backend that is down keeps them.
	 */
	private function isKept(Desk $desk, Office $office, int $now): bool {
		if ($desk->getAuthorizedUntil() >= $now) {
			return true;
		}
		$owner = $this->userManager->get($desk->getUid());
		try {
			if ($owner === null || !$this->accessPolicy->isMember($owner, $office)) {
				$this->desks->delete($desk);
				return false;
			}
		} catch (ApiException) {
			return true;
		}
		$desk->setAuthorizedUntil($now + self::AUTHORIZATION_MS);
		$this->desks->update($desk);
		return true;
	}
}
