<?php

declare(strict_types=1);

/**
 * SPDX-FileCopyrightText: 2026 Hoang Pham
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

namespace OCA\VirtualOffice\Tests\Service;

use OCA\VirtualOffice\Db\Office;
use OCA\VirtualOffice\Db\Presence;
use OCA\VirtualOffice\Db\PresenceMapper;
use OCA\VirtualOffice\Db\Watch;
use OCA\VirtualOffice\Db\WatchMapper;
use OCA\VirtualOffice\Service\AccessPolicy;
use OCA\VirtualOffice\Service\Clock;
use OCA\VirtualOffice\Service\RoomService;
use OCA\VirtualOffice\Service\WatchService;
use OCP\IUser;
use OCP\IUserManager;
use OCP\Notification\IManager;
use OCP\Notification\INotification;
use PHPUnit\Framework\Attributes\AllowMockObjectsWithoutExpectations;
use PHPUnit\Framework\MockObject\MockObject;
use PHPUnit\Framework\MockObject\Stub;
use PHPUnit\Framework\TestCase;

#[AllowMockObjectsWithoutExpectations]
class WatchServiceTest extends TestCase {
	private const NOW = 7_000_000;

	private WatchMapper&MockObject $watches;
	private PresenceMapper&Stub $presences;
	private AccessPolicy&Stub $policy;
	private IManager&MockObject $notifications;
	private WatchService $service;
	private Office $office;
	/** @var array<string, IUser> */
	private array $users = [];
	/** @var list<string> */
	private array $notified = [];

	protected function setUp(): void {
		$this->watches = $this->createMock(WatchMapper::class);
		$this->presences = $this->createStub(PresenceMapper::class);
		$this->policy = $this->createStub(AccessPolicy::class);
		$this->notifications = $this->createMock(IManager::class);
		foreach (['alice', 'bao', 'chi', 'dan'] as $uid) {
			$user = $this->createStub(IUser::class);
			$user->method('getUID')->willReturn($uid);
			$this->users[$uid] = $user;
		}
		$userManager = $this->createStub(IUserManager::class);
		$userManager->method('get')->willReturnCallback(fn (string $uid) => $this->users[$uid] ?? null);
		$this->notifications->method('createNotification')->willReturnCallback(function () {
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
		$clock = $this->createStub(Clock::class);
		$clock->method('nowMs')->willReturn(self::NOW);
		$this->service = new WatchService($this->watches, $this->presences, $this->policy, $userManager, $this->notifications, $clock);
		$this->office = new Office();
		$this->office->setId(7);
		$this->office->setToken(str_repeat('a', 32));
	}

	private function watch(string $uid): Watch {
		$watch = new Watch();
		$watch->setId(crc32($uid));
		$watch->setOfficeId(7);
		$watch->setUid($uid);
		$watch->setUidKey(RoomService::uidKey($uid));
		$watch->setExpiresAt(self::NOW + 60_000);
		return $watch;
	}

	public function testAnArrivalTellsEachWatcherOnceIfTheyStillBelongAndAreNotInside(): void {
		$this->watches->method('findActiveByOffice')->willReturn([$this->watch('bao'), $this->watch('chi'), $this->watch('dan')]);
		$this->policy->method('isWelcome')->willReturnCallback(fn (IUser $u) => $u->getUID() !== 'chi');
		$inside = new Presence();
		$inside->setOfficeId(7);
		$inside->setLeaseUntil(self::NOW + 10_000);
		$this->presences->method('findByUidKey')->willReturnCallback(fn (string $key) => $key === RoomService::uidKey('dan') ? $inside : null);
		$this->watches->expects($this->once())->method('deleteFor')->with(7, RoomService::uidKey('alice'));
		$this->watches->expects($this->exactly(3))->method('delete');
		$this->notifications->expects($this->once())->method('notify');

		$this->service->arrived($this->office, $this->users['alice']);
		$this->assertSame(['bao'], $this->notified);
	}

	public function testWatchesEndWithinADay(): void {
		$this->watches->method('findFor')->willReturn(null);
		$this->watches->expects($this->once())->method('insert')->with($this->callback(fn (Watch $w) => $w->getExpiresAt() === self::NOW + 86_400_000));
		$this->assertSame(['watching' => true, 'expiresAt' => self::NOW + 86_400_000], $this->service->set($this->users['bao'], $this->office, self::NOW + 999_999_999));
	}

	public function testAnExpiredWatchIsNotReported(): void {
		$watch = $this->watch('bao');
		$watch->setExpiresAt(self::NOW);
		$this->watches->method('findFor')->willReturn($watch);
		$this->assertSame(['watching' => false, 'expiresAt' => null], $this->service->get($this->users['bao'], $this->office));
	}
}
