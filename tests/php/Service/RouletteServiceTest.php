<?php

declare(strict_types=1);

/**
 * SPDX-FileCopyrightText: 2026 Hoang Pham
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

namespace OCA\VirtualOffice\Tests\Service;

use OCA\VirtualOffice\Db\Office;
use OCA\VirtualOffice\Db\OfficeMapper;
use OCA\VirtualOffice\Db\RouletteEntry;
use OCA\VirtualOffice\Db\RouletteMapper;
use OCA\VirtualOffice\Exception\ApiException;
use OCA\VirtualOffice\Service\AccessPolicy;
use OCA\VirtualOffice\Service\Clock;
use OCA\VirtualOffice\Service\RoomService;
use OCA\VirtualOffice\Service\RouletteService;
use OCA\VirtualOffice\Service\TimeService;
use OCP\IUser;
use OCP\IUserManager;
use OCP\Notification\IManager;
use OCP\Notification\INotification;
use PHPUnit\Framework\Attributes\AllowMockObjectsWithoutExpectations;
use PHPUnit\Framework\MockObject\Stub;
use PHPUnit\Framework\TestCase;

#[AllowMockObjectsWithoutExpectations]
class RouletteServiceTest extends TestCase {
	private RouletteMapper&Stub $entries;
	private AccessPolicy&Stub $policy;
	private RouletteService $service;
	private Office $office;
	/** @var list<string> */
	private array $notified = [];
	/** @var array<string, string> uid => time zone; everyone works 09:00 to 17:00 on weekdays */
	private array $zones = [];

	protected function setUp(): void {
		$this->entries = $this->createStub(RouletteMapper::class);
		$this->policy = $this->createStub(AccessPolicy::class);
		$users = $this->createStub(IUserManager::class);
		$users->method('get')->willReturnCallback(function (string $uid) {
			$user = $this->createStub(IUser::class);
			$user->method('getUID')->willReturn($uid);
			return $user;
		});
		$notifications = $this->createStub(IManager::class);
		$notifications->method('createNotification')->willReturnCallback(function () {
			$notification = $this->createStub(INotification::class);
			foreach (['setApp', 'setDateTime', 'setObject', 'setSubject'] as $method) {
				$notification->method($method)->willReturnSelf();
			}
			$notification->method('setUser')->willReturnCallback(function (string $uid) use ($notification) {
				$this->notified[] = $uid;
				return $notification;
			});
			return $notification;
		});
		$time = $this->createStub(TimeService::class);
		$time->method('forUsers')->willReturnCallback(function (array $uids) {
			$days = array_fill(1, 7, []);
			for ($d = 1; $d <= 5; $d++) {
				$days[$d] = [[540, 1020]];
			}
			$result = [];
			foreach ($uids as $uid) {
				$zone = $this->zones[$uid] ?? 'Europe/Berlin';
				$result[$uid] = ['timeZone' => $zone, 'hours' => ['timeZone' => $zone, 'days' => $days, 'default' => true]];
			}
			return $result;
		});
		$clock = $this->createStub(Clock::class);
		$clock->method('nowMs')->willReturn((new \DateTimeImmutable('2027-03-07 12:00 UTC'))->getTimestamp() * 1000);
		$this->service = new RouletteService($this->entries, $this->createStub(OfficeMapper::class), $this->policy, $users, $notifications, $clock, $time);
		$this->office = new Office();
		$this->office->setId(3);
		$this->office->setToken(str_repeat('b', 32));
		$this->office->setAudienceKind('instance');
	}

	private function entry(string $uid, ?string $lastPartner = null): RouletteEntry {
		$entry = new RouletteEntry();
		$entry->setOfficeId(3);
		$entry->setUid($uid);
		$entry->setUidKey(RoomService::uidKey($uid));
		$entry->setLastPartnerKey($lastPartner === null ? null : RoomService::uidKey($lastPartner));
		return $entry;
	}

	public function testPairsAvoidLastWeeksPartnerAndTheOddOneWaits(): void {
		$this->entries->method('findByOffice')->willReturn([$this->entry('ana', 'ben'), $this->entry('ben', 'ana'), $this->entry('cam'), $this->entry('dia'), $this->entry('eli')]);
		$this->policy->method('isMember')->willReturn(true);
		$this->policy->method('isWelcome')->willReturn(true);
		$pairs = $this->service->pairOffice($this->office, fn (array $pool) => $pool);
		$this->assertSame([['ana', 'cam'], ['ben', 'dia']], $pairs);
		$this->assertSame(['ana', 'cam', 'ben', 'dia'], $this->notified);
	}

	public function testPeopleArePairedWithWhoeverSharesTheMostWorkingHours(): void {
		// Ana in Berlin, Ben in Tokyo (no shared hours), Cam in New York (3 hours with Ana), Dia in Seoul (all hours with Ben).
		$this->zones = ['ana' => 'Europe/Berlin', 'ben' => 'Asia/Tokyo', 'cam' => 'America/New_York', 'dia' => 'Asia/Seoul'];
		$this->entries->method('findByOffice')->willReturn([$this->entry('ana'), $this->entry('ben'), $this->entry('cam'), $this->entry('dia')]);
		$this->policy->method('isMember')->willReturn(true);
		$this->policy->method('isWelcome')->willReturn(true);
		$this->assertSame([['ana', 'cam'], ['ben', 'dia']], $this->service->pairOffice($this->office, fn (array $pool) => $pool));
	}

	public function testLastWeeksPartnerIsAvoidedEvenWithMoreSharedHours(): void {
		$this->zones = ['ana' => 'Europe/Berlin', 'ben' => 'Europe/Paris', 'cam' => 'America/New_York'];
		$this->entries->method('findByOffice')->willReturn([$this->entry('ana', 'ben'), $this->entry('ben', 'ana'), $this->entry('cam')]);
		$this->policy->method('isMember')->willReturn(true);
		$this->policy->method('isWelcome')->willReturn(true);
		$this->assertSame([['ana', 'cam']], $this->service->pairOffice($this->office, fn (array $pool) => $pool));
	}

	public function testPeopleRemovedForAWhileWaitAndPeopleWhoLeftAreDropped(): void {
		$this->entries->method('findByOffice')->willReturn([$this->entry('ana'), $this->entry('ben'), $this->entry('cam'), $this->entry('dia')]);
		$deleted = [];
		$this->entries->method('deleteFor')->willReturnCallback(function (int $officeId, string $uidKey) use (&$deleted) {
			$deleted[] = $uidKey;
		});
		$this->policy->method('isMember')->willReturnCallback(fn (IUser $u) => $u->getUID() !== 'dia');
		$this->policy->method('isWelcome')->willReturnCallback(fn (IUser $u) => $u->getUID() !== 'ben');
		$this->assertSame([['ana', 'cam']], $this->service->pairOffice($this->office, fn (array $pool) => $pool));
		$this->assertSame([RoomService::uidKey('dia')], $deleted);
	}

	public function testNobodyIsPairedWhileTheAudienceCannotBeChecked(): void {
		$this->entries->method('findByOffice')->willReturn([$this->entry('ana'), $this->entry('ben')]);
		$this->policy->method('isMember')->willThrowException(new ApiException('AUDIENCE_UNAVAILABLE', 503));
		$this->assertSame([], $this->service->pairOffice($this->office));
		$this->assertSame([], $this->notified);
	}

	public function testOnlyGroupOfficesAndOfficesForEveryoneHaveARoulette(): void {
		$team = new Office();
		$team->setAudienceKind('team');
		$this->expectException(ApiException::class);
		$this->service->join($this->createStub(IUser::class), $team);
	}
}
