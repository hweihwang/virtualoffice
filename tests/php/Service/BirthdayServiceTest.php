<?php

declare(strict_types=1);

/**
 * SPDX-FileCopyrightText: 2026 Hoang Pham
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

namespace OCA\VirtualOffice\Tests\Service;

use OCA\VirtualOffice\Service\BirthdayService;
use OCA\VirtualOffice\Service\TimeService;
use OCP\Accounts\IAccount;
use OCP\Accounts\IAccountManager;
use OCP\Accounts\IAccountProperty;
use OCP\IUser;
use PHPUnit\Framework\TestCase;

class BirthdayServiceTest extends TestCase {
	private function service(string $value, string $scope, ?string $zone = null): BirthdayService {
		$property = $this->createStub(IAccountProperty::class);
		$property->method('getValue')->willReturn($value);
		$property->method('getScope')->willReturn($scope);
		$account = $this->createStub(IAccount::class);
		$account->method('getProperty')->willReturn($property);
		$accounts = $this->createStub(IAccountManager::class);
		$accounts->method('getAccount')->willReturn($account);
		$time = $this->createStub(TimeService::class);
		$time->method('timeZone')->willReturn($zone);
		return new BirthdayService($accounts, $time);
	}

	public function testOnlySharedBirthDatesCount(): void {
		$user = $this->createStub(IUser::class);
		$user->method('getUID')->willReturn('alice');
		$this->assertSame('03-14', $this->service('1990-03-14', IAccountManager::SCOPE_LOCAL)->monthDay($user));
		$this->assertNull($this->service('1990-03-14', IAccountManager::SCOPE_PRIVATE)->monthDay($user));
		$this->assertNull($this->service('', IAccountManager::SCOPE_LOCAL)->monthDay($user));
	}

	public function testTodayIsTheDateWhereThePersonIs(): void {
		// 22:00 UTC on March 14 is already March 15 in Hanoi, still March 14 in Los Angeles.
		$now = (new \DateTimeImmutable('2027-03-14 22:00 UTC'))->getTimestamp() * 1000;
		$hanoi = $this->service('1990-03-15', IAccountManager::SCOPE_LOCAL, 'Asia/Ho_Chi_Minh');
		$this->assertTrue($hanoi->isToday('bao', '03-15', $now));
		$this->assertFalse($hanoi->isToday('bao', '03-14', $now));
		$losAngeles = $this->service('1990-03-14', IAccountManager::SCOPE_LOCAL, 'America/Los_Angeles');
		$this->assertTrue($losAngeles->isToday('dana', '03-14', $now));
		$this->assertFalse($losAngeles->isToday('dana', null, $now));
	}

	public function testWithoutATimeZoneTheServerDateCounts(): void {
		$now = (new \DateTimeImmutable('2027-03-14 12:00', new \DateTimeZone(date_default_timezone_get())))->getTimestamp() * 1000;
		$this->assertTrue($this->service('', IAccountManager::SCOPE_LOCAL)->isToday('alice', '03-14', $now));
	}
}
