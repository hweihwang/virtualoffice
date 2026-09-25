<?php

declare(strict_types=1);

/**
 * SPDX-FileCopyrightText: 2026 Hoang Pham
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

namespace OCA\VirtualOffice\Listener;

use OCA\VirtualOffice\Db\DeskMapper;
use OCA\VirtualOffice\Db\OfficeMapper;
use OCA\VirtualOffice\Service\KnockService;
use OCA\VirtualOffice\Service\RoomService;
use OCA\VirtualOffice\Service\RouletteService;
use OCA\VirtualOffice\Service\WatchService;
use OCP\EventDispatcher\Event;
use OCP\EventDispatcher\IEventListener;
use OCP\User\Events\UserChangedEvent;
use OCP\User\Events\UserDeletedEvent;

/**
 * Ends the presence of deleted or disabled accounts right away and drops
 * their attribution, desks, knocks, arrival requests, roulette sign-ups and manager roles when deleted. Preferences are user
 * config, which core removes with the account.
 *
 * @template-implements IEventListener<UserDeletedEvent|UserChangedEvent>
 */
class UserDeletedListener implements IEventListener {
	public function __construct(
		private RoomService $room,
		private OfficeMapper $mapper,
		private DeskMapper $desks,
		private KnockService $knocks,
		private WatchService $watches,
		private RouletteService $roulette,
	) {
	}

	#[\Override]
	public function handle(Event $event): void {
		if ($event instanceof UserChangedEvent) {
			if ($event->getFeature() === 'enabled' && $event->getValue() === false) {
				$this->room->evict($event->getUser()->getUID(), null, 'access');
			}
			return;
		}
		if (!$event instanceof UserDeletedEvent) {
			return;
		}
		$uid = $event->getUser()->getUID();
		$this->room->evict($uid, null, 'access');
		$this->mapper->deleteByUserAttribution($uid);
		$this->desks->deleteByUidKey(RoomService::uidKey($uid));
		$this->knocks->forgetUser($uid);
		$this->watches->forgetUser($uid);
		$this->roulette->forgetUser($uid);
		foreach ($this->mapper->findWithManager($uid) as $office) {
			$office->setManagers(json_encode(array_values(array_diff($office->getManagerList(), [$uid])), JSON_THROW_ON_ERROR));
			$removals = $office->getRemovalMap();
			unset($removals[$uid]);
			$office->setRemovals(json_encode($removals, JSON_THROW_ON_ERROR | JSON_FORCE_OBJECT));
			$this->mapper->updateIfRevision($office, $office->getConfigRev());
		}
	}
}
