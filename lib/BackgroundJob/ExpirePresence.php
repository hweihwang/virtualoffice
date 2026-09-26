<?php

declare(strict_types=1);

/**
 * SPDX-FileCopyrightText: 2026 Hoang Pham
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

namespace OCA\VirtualOffice\BackgroundJob;

use OCA\VirtualOffice\Service\Clock;
use OCA\VirtualOffice\Service\KnockService;
use OCA\VirtualOffice\Service\PreferenceService;
use OCA\VirtualOffice\Service\RoomService;
use OCA\VirtualOffice\Service\WatchService;
use OCP\AppFramework\Utility\ITimeFactory;
use OCP\BackgroundJob\IJob;
use OCP\BackgroundJob\TimedJob;

/** Removes presences whose lease ran out while nobody was polling the room, knocks nobody answered, expired arrival requests and expired "Today" notes. */
class ExpirePresence extends TimedJob {
	public function __construct(
		ITimeFactory $time,
		private RoomService $room,
		private KnockService $knocks,
		private WatchService $watches,
		private PreferenceService $preferences,
		private Clock $clock,
	) {
		parent::__construct($time);
		$this->setInterval(300);
		$this->setTimeSensitivity(IJob::TIME_SENSITIVE);
	}

	#[\Override]
	protected function run($argument): void {
		$this->room->expireStale();
		$this->knocks->expire();
		$this->watches->expire();
		$this->preferences->expireToday($this->clock->nowMs());
	}
}
