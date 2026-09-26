<?php

declare(strict_types=1);

/**
 * SPDX-FileCopyrightText: 2026 Hoang Pham
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

namespace OCA\VirtualOffice\Tests\Service;

use OCA\VirtualOffice\Db\DeskMapper;
use OCA\VirtualOffice\Db\Office;
use OCA\VirtualOffice\Db\OfficeMapper;
use OCA\VirtualOffice\Db\Presence;
use OCA\VirtualOffice\Db\PresenceMapper;
use OCA\VirtualOffice\Db\RouletteMapper;
use OCA\VirtualOffice\Exception\ApiException;
use OCA\VirtualOffice\Service\AccessPolicy;
use OCA\VirtualOffice\Service\BirthdayService;
use OCA\VirtualOffice\Service\Catalog;
use OCA\VirtualOffice\Service\Clock;
use OCA\VirtualOffice\Service\Movement;
use OCA\VirtualOffice\Service\PreferenceService;
use OCA\VirtualOffice\Service\PushService;
use OCA\VirtualOffice\Service\RoomService;
use OCA\VirtualOffice\Service\Settings;
use OCA\VirtualOffice\Service\WatchService;
use OCP\IDBConnection;
use OCP\IUser;
use OCP\IUserManager;
use OCP\Teams\ITeamManager;
use OCP\Teams\ITeamResourceProvider;
use PHPUnit\Framework\Attributes\AllowMockObjectsWithoutExpectations;
use PHPUnit\Framework\MockObject\MockObject;
use PHPUnit\Framework\MockObject\Stub;
use PHPUnit\Framework\TestCase;

/** Mocks carry expectations only in the tests that are about them. */
#[AllowMockObjectsWithoutExpectations]
class RoomServiceTest extends TestCase {
	private const NOW = 10_000_000;
	private const SESSION = '0123456789abcdef0123456789abcdef';

	private OfficeMapper&MockObject $offices;
	private PresenceMapper&MockObject $presences;
	private AccessPolicy&MockObject $policy;
	private IUserManager&Stub $users;
	private ITeamManager&Stub $teams;
	private Settings&Stub $settings;
	private PreferenceService&Stub $preferences;
	private RoomService $room;
	private Office $office;
	private IUser $user;

	protected function setUp(): void {
		$this->offices = $this->createMock(OfficeMapper::class);
		$this->presences = $this->createMock(PresenceMapper::class);
		$this->policy = $this->createMock(AccessPolicy::class);
		$clock = $this->createStub(Clock::class);
		$clock->method('nowMs')->willReturn(self::NOW);
		$catalog = new Catalog();
		$this->users = $this->createStub(IUserManager::class);
		$this->teams = $this->createStub(ITeamManager::class);
		$this->settings = $this->createStub(Settings::class);
		$this->preferences = $this->createStub(PreferenceService::class);
		$this->settings->method('roomCapacity')->willReturn(32);
		$this->room = new RoomService(
			$this->createStub(IDBConnection::class),
			$this->offices,
			$this->presences,
			$this->createStub(DeskMapper::class),
			$this->createStub(RouletteMapper::class),
			$this->policy,
			$catalog,
			new Movement($catalog),
			$this->preferences,
			$this->createStub(PushService::class),
			$this->settings,
			$this->createStub(WatchService::class),
			$this->createStub(BirthdayService::class),
			$this->users,
			$this->teams,
			$clock,
		);
		$this->office = new Office();
		$this->office->setId(7);
		$this->office->setPresenceRev(3);
		$this->office->setLayoutId('starter-office-v1');
		$this->user = $this->createStub(IUser::class);
		$this->user->method('getUID')->willReturn('alice');
		$this->offices->method('findById')->willReturn($this->office);
		$this->offices->method('lockAndBump')->willReturn($this->office);
	}

	private function presence(int $leaseLeft, int $authorizationLeft): Presence {
		$row = new Presence();
		$row->setId(11);
		$row->setOfficeId(7);
		$row->setUid('alice');
		$row->setSession(self::SESSION);
		$row->setLeaseUntil(self::NOW + $leaseLeft);
		$row->setAuthorizedUntil(self::NOW + $authorizationLeft);
		$row->setTrajectory(json_encode(['id' => 0, 'points' => [[5, 17]], 'arriveAt' => [0]]));
		return $row;
	}

	public function testRenewingTheLeaseDoesNotExtendAuthorization(): void {
		$row = $this->presence(10_000, 5_000);
		$this->presences->method('findByUidKey')->willReturn($row);
		$this->presences->method('findByOffice')->willReturn([$row]);
		$this->policy->expects($this->never())->method('assertCanEnter');
		$this->presences->expects($this->once())->method('renewLease')
			->with(11, self::NOW + RoomService::LEASE_MS, self::NOW + 5_000);

		$result = $this->room->poll($this->user, $this->office, self::SESSION, 3);
		$this->assertSame(['changed' => false, 'rev' => 3, 'serverTime' => self::NOW], $result);
	}

	public function testExpiredAuthorizationIsCheckedBeforeExtending(): void {
		$row = $this->presence(80_000, -1);
		$this->presences->method('findByUidKey')->willReturn($row);
		$this->presences->method('findByOffice')->willReturn([$row]);
		$this->policy->expects($this->once())->method('assertCanEnter')->with($this->user, $this->office);
		$this->presences->expects($this->once())->method('renewLease')
			->with(11, self::NOW + RoomService::LEASE_MS, self::NOW + RoomService::AUTHORIZATION_MS);

		$this->room->poll($this->user, $this->office, self::SESSION, 3);
	}

	public function testLostAccessStopsThePoll(): void {
		$row = $this->presence(80_000, -1);
		$this->presences->method('findByUidKey')->willReturn($row);
		$this->policy->method('assertCanEnter')->willThrowException(ApiException::unavailable());
		$this->presences->expects($this->never())->method('renewLease');
		$this->presences->expects($this->once())->method('delete')->with($row);

		$this->expectException(ApiException::class);
		$this->room->poll($this->user, $this->office, self::SESSION, 3);
	}

	public function testOtherWindowAndExpiredLeaseAreReported(): void {
		$this->presences->method('findByUidKey')->willReturnOnConsecutiveCalls(
			$this->presence(80_000, 10_000),
			$this->presence(-1, 10_000),
			null,
		);
		foreach (['TAKEN_OVER' => 'ffffffffffffffffffffffffffffffff', 'NOT_PRESENT' => self::SESSION, 'NOT_PRESENT ' => self::SESSION] as $code => $session) {
			try {
				$this->room->poll($this->user, $this->office, $session, 3);
				$this->fail('Expected ' . $code);
			} catch (ApiException $e) {
				$this->assertSame(trim($code), $e->getApiCode());
			}
		}
	}

	public function testRejectsMalformedSessions(): void {
		$this->expectException(ApiException::class);
		$this->room->poll($this->user, $this->office, 'not-a-session', 3);
	}

	private function user(string $uid): IUser {
		$user = $this->createStub(IUser::class);
		$user->method('getUID')->willReturn($uid);
		return $user;
	}

	public function testRevalidationRemovesPeopleWhoLostAccessWithoutTheirOwnRequests(): void {
		$alice = $this->presence(80_000, 10_000);
		$chi = $this->presence(80_000, -5_000);
		$chi->setUid('chi');
		$chi->setId(12);
		$this->presences->method('findByOffice')->willReturn([$alice, $chi]);
		$this->presences->method('findByUidKey')->willReturn($chi);
		$this->users->method('get')->willReturnCallback(fn (string $uid) => $this->user($uid));
		$this->policy->method('assertCanEnter')->willThrowException(ApiException::unavailable());
		$this->presences->expects($this->once())->method('delete')->with($chi);
		$this->room->revalidate($this->office, 'alice');
	}

	public function testRevalidationKeepsPeopleWhenTheBackendIsDown(): void {
		$chi = $this->presence(80_000, -5_000);
		$chi->setUid('chi');
		$this->presences->method('findByOffice')->willReturn([$chi]);
		$this->users->method('get')->willReturnCallback(fn (string $uid) => $this->user($uid));
		$this->policy->method('assertCanEnter')->willThrowException(new ApiException('AUDIENCE_UNAVAILABLE', 503));
		$this->presences->expects($this->never())->method('delete');
		$this->room->revalidate($this->office);
	}

	public function testRevalidationRenewsOnlyTheAuthorization(): void {
		$chi = $this->presence(80_000, -5_000);
		$chi->setUid('chi');
		$this->presences->method('findByOffice')->willReturn([$chi]);
		$this->users->method('get')->willReturnCallback(fn (string $uid) => $this->user($uid));
		$this->presences->expects($this->once())->method('renewLease')->with(11, self::NOW + 80_000, self::NOW + RoomService::AUTHORIZATION_MS);
		$this->room->revalidate($this->office);
	}

	private function linkedOffice(string $source, string $roomState): Office {
		$office = new Office();
		$office->setId(7);
		$office->setAudienceKind('team');
		$office->setAudienceId('team1');
		$office->setConfig(json_encode(['decor' => [], 'talk' => ['source' => $source, 'token' => 'abcd1234', 'label' => 'Chat']]));
		$office->setRoomState($roomState);
		return $office;
	}

	public function testCallStateIsHiddenOnceTheConversationIsNoLongerSharedWithTheTeam(): void {
		$provider = $this->createStub(ITeamResourceProvider::class);
		$teams = ['team1'];
		$provider->method('isSharedWithTeam')->willReturn(true);
		$provider->method('getTeamsForResource')->willReturnCallback(function () use (&$teams) {
			return $teams;
		});
		$this->teams->method('hasTeamSupport')->willReturn(true);
		$this->teams->method('getProvider')->willReturn($provider);
		$state = '{"call":{"active":true,"since":1,"participants":["chi"]}}';
		$this->assertTrue($this->room->callState($this->linkedOffice('team', $state))['active']);
		$teams = ['team2'];
		$fresh = new RoomService($this->createStub(IDBConnection::class), $this->offices, $this->presences, $this->createStub(DeskMapper::class), $this->createStub(RouletteMapper::class), $this->policy, new Catalog(), new Movement(new Catalog()), $this->createStub(PreferenceService::class), $this->createStub(PushService::class), $this->createStub(Settings::class), $this->createStub(WatchService::class), $this->createStub(BirthdayService::class), $this->users, $this->teams, $this->createStub(Clock::class));
		$this->assertNull($fresh->callState($this->linkedOffice('team', $state)));
		$this->assertNull($fresh->callState($this->linkedOffice('link', $state)));
	}

	public function testCallStateIsUnknownUntilTalkReportsIt(): void {
		$office = $this->linkedOffice('conversation', '{}');
		$office->setAudienceKind('talk');
		$this->assertSame(['known' => false, 'active' => false, 'since' => null, 'participants' => [], 'names' => []], $this->room->callState($office));
		$office->setRoomState('{"call":{"known":true,"active":false,"since":null,"participants":[]}}');
		$this->assertTrue($this->room->callState($office)['known']);
	}

	public function testDeleteRefusesAStaleRevisionInsideTheLock(): void {
		$this->office->setConfigRev(4);
		$this->offices->expects($this->never())->method('delete');
		$this->presences->expects($this->never())->method('deleteByOffice');
		try {
			$this->room->deleteOffice($this->office, 3);
			$this->fail('Stale revision accepted');
		} catch (ApiException $e) {
			$this->assertSame('REVISION_MISMATCH', $e->getApiCode());
		}
	}

	public function testDeleteRemovesPresencesAndTheOfficeTogether(): void {
		$this->office->setConfigRev(4);
		$this->presences->method('findByOffice')->willReturn([$this->presence(80_000, 10_000)]);
		$this->presences->expects($this->once())->method('deleteByOffice')->with(7);
		$this->offices->expects($this->once())->method('delete')->with($this->office);
		$this->room->deleteOffice($this->office, 4);
	}

	/** @param list<array{0: int, 1: int}> $others resting cells of the people already inside */
	private function spawnAmong(array $others): array {
		$rows = [];
		foreach ($others as $i => $cell) {
			$row = $this->presence(80_000, 10_000);
			$row->setUid('other' . $i);
			$row->setSlot($i);
			$row->setTrajectory(json_encode(['id' => 0, 'points' => [$cell], 'arriveAt' => [0]]));
			$rows[] = $row;
		}
		$this->presences->method('findByUidKey')->willReturn(null);
		$this->presences->method('findByOffice')->willReturn($rows);
		$inserted = null;
		$this->presences->method('insert')->willReturnCallback(function (Presence $row) use (&$inserted) {
			$inserted = $row;
			return $row;
		});
		$this->room->enter($this->user, $this->office, self::SESSION, false);
		return $inserted->getTrajectoryData()['points'][0];
	}

	public function testTheFirstPersonArrivesAtTheCoffeeCorner(): void {
		$this->assertSame([5, 5], $this->spawnAmong([]));
	}

	public function testNewcomersArriveNextToTheBiggestGroup(): void {
		// Two people at the focus desks, one in the common area.
		$cell = $this->spawnAmong([[26, 11], [16, 13], [27, 11]]);
		$this->assertNotContains($cell, [[26, 11], [27, 11]]);
		$this->assertSame('focus', (new Catalog())->zoneAt((new Catalog())->layout('starter-office-v1'), $cell[0], $cell[1]));
		$this->assertSame(3, min(max(abs($cell[0] - 26), abs($cell[1] - 11)), max(abs($cell[0] - 27), abs($cell[1] - 11))));
	}

	public function testNewcomersArriveNextToAPersonAwayFromTheZoneCentre(): void {
		// Alice stands at the far edge of the coffee corner, not at its centre (5,5).
		$cell = $this->spawnAmong([[9, 7]]);
		// Close to her with two free cells between, so the name tags do not overlap.
		$this->assertSame(3, max(abs($cell[0] - 9), abs($cell[1] - 7)));
	}

	public function testANewNoteShowsAtOnceInTheOfficeOfThePerson(): void {
		$note = ['text' => 'Mở bài Q3', 'expiresAt' => self::NOW + 60_000];
		$this->preferences->method('setToday')->willReturn($note);
		$row = $this->presence(80_000, 10_000);
		$this->presences->method('findByUidKey')->willReturn($row);
		$this->presences->method('findByOffice')->willReturn([$row]);
		$this->presences->expects($this->once())->method('update')->with($this->callback(
			fn (Presence $p) => $p->getNote() === '{"text":"Mở bài Q3","expiresAt":' . (self::NOW + 60_000) . '}' && $p->getNoteText(self::NOW) === 'Mở bài Q3' && $p->getNoteText(self::NOW + 60_000) === null,
		));
		$this->assertSame(['today' => $note], $this->room->setNote($this->user, 'Mở bài Q3', self::NOW + 60_000));
	}

	public function testFocusSessionsStartJoinAndEndWithTheLastOneOut(): void {
		$row = $this->presence(80_000, 10_000);
		$this->presences->method('findByUidKey')->willReturn($row);
		$this->presences->method('findByOffice')->willReturn([$row]);
		$saved = [];
		$this->offices->method('updateRoomState')->willReturnCallback(function (int $id, string $state) use (&$saved) {
			$saved[] = json_decode($state, true)['focus'];
		});
		try {
			$this->room->joinFocus($this->user, $this->office, self::SESSION, 30);
			$this->fail('Accepted 30 minutes');
		} catch (ApiException $e) {
			$this->assertSame('INVALID_INPUT', $e->getApiCode());
		}
		$started = $this->room->joinFocus($this->user, $this->office, self::SESSION, 25);
		$this->assertSame(['startedAt' => self::NOW, 'endsAt' => self::NOW + 25 * 60_000, 'minutes' => 25, 'uids' => ['alice']], $started['focus']);

		// Someone else already runs one: joining keeps its length.
		$this->office->setRoomState(json_encode(['focus' => ['startedAt' => self::NOW - 1000, 'endsAt' => self::NOW + 60_000, 'minutes' => 50, 'uids' => ['bao']]]));
		$this->assertSame(['bao', 'alice'], $this->room->joinFocus($this->user, $this->office, self::SESSION, 25)['focus']['uids']);
		$this->assertSame(['bao'], $this->room->leaveFocus($this->user, $this->office, self::SESSION)['focus']['uids']);
		$this->office->setRoomState(json_encode(['focus' => ['startedAt' => self::NOW - 1000, 'endsAt' => self::NOW + 60_000, 'minutes' => 50, 'uids' => ['alice']]]));
		$this->assertNull($this->room->leaveFocus($this->user, $this->office, self::SESSION)['focus']);
		$this->assertNull(end($saved));
	}
}
