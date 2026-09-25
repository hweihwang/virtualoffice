<?php

declare(strict_types=1);

/**
 * SPDX-FileCopyrightText: 2026 Hoang Pham
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

namespace OCA\VirtualOffice\Tests\Service;

use OCA\VirtualOffice\Service\BirthdayService;
use OCP\Accounts\IAccount;
use OCP\Accounts\IAccountManager;
use OCP\Accounts\IAccountProperty;
use OCP\IUser;
use PHPUnit\Framework\TestCase;

class BirthdayServiceTest extends TestCase {
	private function service(string $value, string $scope): BirthdayService {
		$property = $this->createStub(IAccountProperty::class);
		$property->method('getValue')->willReturn($value);
		$property->method('getScope')->willReturn($scope);
		$account = $this->createStub(IAccount::class);
		$account->method('getProperty')->willReturn($property);
		$accounts = $this->createStub(IAccountManager::class);
		$accounts->method('getAccount')->willReturn($account);
		return new BirthdayService($accounts);
	}

	public function testOnlySharedBirthDatesCount(): void {
		$user = $this->createStub(IUser::class);
		$user->method('getUID')->willReturn('alice');
		$this->assertSame('03-14', $this->service('1990-03-14', IAccountManager::SCOPE_LOCAL)->monthDay($user));
		$this->assertNull($this->service('1990-03-14', IAccountManager::SCOPE_PRIVATE)->monthDay($user));
		$this->assertNull($this->service('', IAccountManager::SCOPE_LOCAL)->monthDay($user));
	}

	public function testTodayUsesTheServerDate(): void {
		$now = mktime(12, 0, 0, 3, 14, 2027) * 1000;
		$this->assertTrue(BirthdayService::isToday('03-14', $now));
		$this->assertFalse(BirthdayService::isToday('03-15', $now));
		$this->assertFalse(BirthdayService::isToday(null, $now));
	}
}
