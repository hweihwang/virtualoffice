<?php

declare(strict_types=1);

/**
 * SPDX-FileCopyrightText: 2026 Hoang Pham
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

namespace OCA\VirtualOffice\Listener;

use OCA\VirtualOffice\Db\OfficeMapper;
use OCA\VirtualOffice\Db\PresenceMapper;
use OCA\VirtualOffice\Service\AccessPolicy;
use OCA\VirtualOffice\Service\RoomService;
use OCP\EventDispatcher\Event;
use OCP\EventDispatcher\IEventListener;
use OCP\Group\Events\UserRemovedEvent;

/**
 * Takes someone out of a group office as soon as they leave the group.
 * Team changes are caught by the regular access re-check.
 *
 * @template-implements IEventListener<UserRemovedEvent>
 */
class GroupMembershipListener implements IEventListener {
	public function __construct(
		private RoomService $room,
		private PresenceMapper $presenceMapper,
		private OfficeMapper $officeMapper,
	) {
	}

	#[\Override]
	public function handle(Event $event): void {
		if (!$event instanceof UserRemovedEvent) {
			return;
		}
		$uid = $event->getUser()->getUID();
		$presence = $this->presenceMapper->findByUidKey(RoomService::uidKey($uid));
		if ($presence === null) {
			return;
		}
		$office = $this->officeMapper->findById($presence->getOfficeId());
		if ($office->getAudienceKind() === AccessPolicy::KIND_GROUP && $office->getAudienceId() === $event->getGroup()->getGID()) {
			$this->room->evict($uid, $office->getId(), 'access');
		}
	}
}
