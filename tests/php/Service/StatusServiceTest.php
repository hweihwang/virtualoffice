<?php

declare(strict_types=1);

/**
 * SPDX-FileCopyrightText: 2026 Hoang Pham
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

namespace OCA\VirtualOffice\Tests\Service;

use OCA\VirtualOffice\Service\StatusService;
use OCP\UserStatus\IManager;
use OCP\UserStatus\IUserStatus;
use PHPUnit\Framework\TestCase;

class StatusServiceTest extends TestCase {
	private function userStatus(string $status, ?string $message = null): IUserStatus {
		$stub = $this->createStub(IUserStatus::class);
		$stub->method('getStatus')->willReturn($status);
		$stub->method('getMessage')->willReturn($message);
		$stub->method('getIcon')->willReturn(null);
		$stub->method('getClearAt')->willReturn(null);
		return $stub;
	}

	public function testInvisibleAndOfflinePeopleShowNoStatus(): void {
		$manager = $this->createStub(IManager::class);
		$manager->method('getUserStatuses')->willReturn([
			'alice' => $this->userStatus(IUserStatus::BUSY, 'In a meeting'),
			'bao' => $this->userStatus(IUserStatus::INVISIBLE),
			'chi' => $this->userStatus(IUserStatus::OFFLINE),
			'dan' => $this->userStatus(IUserStatus::AWAY),
		]);
		$statuses = (new StatusService($manager))->forUsers(['alice', 'bao', 'chi', 'dan']);
		$this->assertSame(['alice', 'dan'], array_keys($statuses));
		$this->assertSame(['status' => 'busy', 'message' => 'In a meeting', 'icon' => null, 'clearAt' => null], $statuses['alice']);
	}

	public function testNoQueryWithoutPeople(): void {
		$manager = $this->createMock(IManager::class);
		$manager->expects($this->never())->method('getUserStatuses');
		$this->assertSame([], (new StatusService($manager))->forUsers([]));
	}
}
