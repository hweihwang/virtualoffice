<?php

declare(strict_types=1);

/**
 * SPDX-FileCopyrightText: 2026 Hoang Pham
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

namespace OCA\VirtualOffice\Tests\Service;

use OCA\VirtualOffice\Db\Desk;
use OCA\VirtualOffice\Db\DeskMapper;
use OCA\VirtualOffice\Db\Office;
use OCA\VirtualOffice\Db\PresenceMapper;
use OCA\VirtualOffice\Exception\ApiException;
use OCA\VirtualOffice\Service\AccessPolicy;
use OCA\VirtualOffice\Service\BirthdayService;
use OCA\VirtualOffice\Service\Catalog;
use OCA\VirtualOffice\Service\Clock;
use OCA\VirtualOffice\Service\DeskService;
use OCA\VirtualOffice\Service\PreferenceService;
use OCA\VirtualOffice\Service\RoomService;
use OCA\VirtualOffice\Service\StatusService;
use OCP\IDBConnection;
use OCP\IUser;
use OCP\IUserManager;
use PHPUnit\Framework\Attributes\AllowMockObjectsWithoutExpectations;
use PHPUnit\Framework\MockObject\MockObject;
use PHPUnit\Framework\TestCase;

#[AllowMockObjectsWithoutExpectations]
class DeskServiceTest extends TestCase {
	private const NOW = 5_000_000;

	private DeskMapper&MockObject $desks;
	private AccessPolicy&MockObject $policy;
	private RoomService&MockObject $room;
	private DeskService $service;
	private Office $office;
	/** @var array<string, IUser> */
	private array $users = [];

	protected function setUp(): void {
		$this->desks = $this->createMock(DeskMapper::class);
		$this->policy = $this->createMock(AccessPolicy::class);
		$this->room = $this->createMock(RoomService::class);
		$clock = $this->createStub(Clock::class);
		$clock->method('nowMs')->willReturn(self::NOW);
		$userManager = $this->createStub(IUserManager::class);
		$userManager->method('get')->willReturnCallback(fn (string $uid) => $this->users[$uid] ?? null);
		$userManager->method('getDisplayName')->willReturnCallback(fn (string $uid) => ucfirst($uid));
		foreach (['alice', 'bao', 'chi'] as $uid) {
			$user = $this->createStub(IUser::class);
			$user->method('getUID')->willReturn($uid);
			$this->users[$uid] = $user;
		}
		$this->service = new DeskService($this->createStub(IDBConnection::class), $this->desks, $this->createStub(PresenceMapper::class), $this->policy,
			$userManager, $this->createStub(PreferenceService::class), $this->createStub(StatusService::class), $this->room, new Catalog(), $clock, $this->createStub(BirthdayService::class));
		$this->office = new Office();
		$this->office->setId(7);
		$this->office->setLayoutId('starter-office-v1');
	}

	private function desk(string $deskId, string $uid, int $authorizedFor): Desk {
		$desk = new Desk();
		$desk->setOfficeId(7);
		$desk->setDeskId($deskId);
		$desk->setUid($uid);
		$desk->setUidKey(RoomService::uidKey($uid));
		$desk->setAuthorizedUntil(self::NOW + $authorizedFor);
		return $desk;
	}

	public function testOwnersWhoLeftLoseTheirDeskAndOthersAreRecheckedOnceAMinute(): void {
		$this->desks->method('findByOffice')->willReturn([$this->desk('d1', 'bao', -1), $this->desk('d2', 'chi', -1), $this->desk('d3', 'alice', 30_000)]);
		$this->policy->method('isMember')->willReturnCallback(fn (IUser $user) => $user->getUID() !== 'chi');
		$this->desks->expects($this->once())->method('delete')->with($this->callback(fn (Desk $d) => $d->getUid() === 'chi'));
		$this->desks->expects($this->once())->method('update')->with($this->callback(fn (Desk $d) => $d->getUid() === 'bao' && $d->getAuthorizedUntil() === self::NOW + DeskService::AUTHORIZATION_MS));

		$list = $this->service->list($this->users['alice'], $this->office);
		$this->assertSame(['bao', 'alice'], array_column($list['desks'], 'uid'));
		$this->assertSame('Bao', $list['desks'][0]['name']);
	}

	public function testDesksAreKeptWhileTheAudienceBackendIsDown(): void {
		$this->desks->method('findByOffice')->willReturn([$this->desk('d1', 'bao', -1)]);
		$this->policy->method('isMember')->willThrowException(new ApiException('AUDIENCE_UNAVAILABLE', 503));
		$this->desks->expects($this->never())->method('delete');
		$this->assertCount(1, $this->service->list($this->users['alice'], $this->office)['desks']);
	}

	public function testClaimingATakenDeskFails(): void {
		$this->desks->method('findByOffice')->willReturn([$this->desk('d1', 'bao', 30_000)]);
		$this->desks->expects($this->never())->method('insert');
		$this->room->expects($this->never())->method('announceDesks');
		try {
			$this->service->claim($this->users['alice'], $this->office, 'd1');
			$this->fail('Took a taken desk');
		} catch (ApiException $e) {
			$this->assertSame('DESK_TAKEN', $e->getApiCode());
		}
	}

	public function testClaimMovesTheUsersDeskAndTellsTheRoom(): void {
		$this->desks->method('findByOffice')->willReturn([$this->desk('d1', 'bao', 30_000)]);
		$this->desks->expects($this->once())->method('deleteFor')->with(7, RoomService::uidKey('alice'));
		$this->desks->expects($this->once())->method('insert')->with($this->callback(fn (Desk $d) => $d->getDeskId() === 'd2' && $d->getUid() === 'alice'));
		$this->room->expects($this->once())->method('announceDesks')->with($this->office);
		$this->service->claim($this->users['alice'], $this->office, 'd2');
	}

	public function testUnknownDesksAreRejected(): void {
		$this->expectException(ApiException::class);
		$this->service->claim($this->users['alice'], $this->office, 'd99');
	}

	public function testOnlyOwnersAndManagersFreeADesk(): void {
		$this->desks->method('findByOffice')->willReturn([$this->desk('d1', 'bao', 30_000)]);
		$this->policy->method('canManage')->willReturnCallback(fn (IUser $user) => $user->getUID() === 'chi');
		try {
			$this->service->release($this->users['alice'], $this->office, 'd1');
			$this->fail('Freed someone else\'s desk');
		} catch (ApiException $e) {
			$this->assertSame('ACTION_DENIED', $e->getApiCode());
		}
		$this->desks->expects($this->once())->method('delete');
		$this->service->release($this->users['chi'], $this->office, 'd1');
	}

	public function testATemporaryRemovalHidesTheDeskWithoutFreeingIt(): void {
		$this->desks->method('findByOffice')->willReturn([$this->desk('d1', 'bao', 30_000), $this->desk('d2', 'chi', 30_000)]);
		$this->policy->method('removedUntil')->willReturnCallback(fn (Office $o, string $uid) => $uid === 'bao' ? self::NOW + 60_000 : null);
		$this->desks->expects($this->never())->method('delete');
		$this->assertSame(['chi'], array_column($this->service->list($this->users['alice'], $this->office)['desks'], 'uid'));
	}
}
