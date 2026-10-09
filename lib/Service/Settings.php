<?php

declare(strict_types=1);

/**
 * SPDX-FileCopyrightText: 2026 Hoang Pham
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

namespace OCA\VirtualOffice\Service;

use OCA\VirtualOffice\AppInfo\Application;
use OCP\IAppConfig;

class Settings {
	public function __construct(
		private IAppConfig $appConfig,
		private Catalog $catalog,
	) {
	}

	public function roomCapacity(): int {
		$max = $this->catalog->maxCapacity();
		return max(2, min($max, $this->appConfig->getValueInt(Application::APP_ID, 'room_capacity', $max)));
	}

	public function setRoomCapacity(int $capacity): void {
		$this->appConfig->setValueInt(Application::APP_ID, 'room_capacity', max(2, min($this->catalog->maxCapacity(), $capacity)));
	}

	public function instanceOfficesEnabled(): bool {
		return $this->appConfig->getValueBool(Application::APP_ID, 'instance_offices', false);
	}

	public function setInstanceOfficesEnabled(bool $enabled): void {
		$this->appConfig->setValueBool(Application::APP_ID, 'instance_offices', $enabled);
	}

	/** Voice between people standing close to each other. On by default. */
	public function voiceEnabled(): bool {
		return $this->appConfig->getValueBool(Application::APP_ID, 'voice', true);
	}

	public function setVoiceEnabled(bool $enabled): void {
		$this->appConfig->setValueBool(Application::APP_ID, 'voice', $enabled);
	}

	/** @return array{roomCapacity: int, maxRoomCapacity: int, instanceOffices: bool, voice: bool} */
	public function toArray(): array {
		return [
			'roomCapacity' => $this->roomCapacity(),
			'maxRoomCapacity' => $this->catalog->maxCapacity(),
			'instanceOffices' => $this->instanceOfficesEnabled(),
			'voice' => $this->voiceEnabled(),
		];
	}
}
