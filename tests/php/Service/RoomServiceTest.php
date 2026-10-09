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
use OCA\VirtualOffice\Db\Signal;
use OCA\VirtualOffice\Db\SignalMapper;
use OCA\VirtualOffice\Exception\ApiException;
use OCA\VirtualOffice\Service\AccessPolicy;
use OCA\VirtualOffice\Service\BirthdayService;
use OCA\VirtualOffice\Service\Catalog;
use OCA\VirtualOffice\Service\Clock;
use OCA\VirtualOffice\Service\Movement;
use OCA\VirtualOffice\Service\MusicLibrary;
use OCA\VirtualOffice\Service\PreferenceService;
use OCA\VirtualOffice\Service\PushService;
use OCA\VirtualOffice\Service\RoomService;
use OCA\VirtualOffice\Service\Settings;
use OCA\VirtualOffice\Service\WatchService;
use OCP\Files\File;
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
	private SignalMapper&MockObject $signals;
	private PushService&MockObject $push;
	private MusicLibrary&Stub $music;
	private bool $voiceAllowed = true;
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
		$this->settings->method('voiceEnabled')->willReturnCallback(fn () => $this->voiceAllowed);
		$this->signals = $this->createMock(SignalMapper::class);
		$this->push = $this->createMock(PushService::class);
		$this->music = $this->createStub(MusicLibrary::class);
		$this->room = new RoomService(
			$this->createStub(IDBConnection::class),
			$this->offices,
			$this->presences,
			$this->createStub(DeskMapper::class),
			$this->createStub(RouletteMapper::class),
			$this->signals,
			$this->policy,
			$catalog,
			new Movement($catalog),
			$this->preferences,
			$this->push,
			$this->settings,
			$this->createStub(WatchService::class),
			$this->createStub(BirthdayService::class),
			$this->music,
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
		$fresh = new RoomService($this->createStub(IDBConnection::class), $this->offices, $this->presences, $this->createStub(DeskMapper::class), $this->createStub(RouletteMapper::class), $this->createStub(SignalMapper::class), $this->policy, new Catalog(), new Movement(new Catalog()), $this->createStub(PreferenceService::class), $this->createStub(PushService::class), $this->createStub(Settings::class), $this->createStub(WatchService::class), $this->createStub(BirthdayService::class), $this->createStub(MusicLibrary::class), $this->users, $this->teams, $this->createStub(Clock::class));
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

	/** Someone in the office standing at a cell. */
	private function at(string $uid, array $cell, string $session = self::SESSION, bool $voice = false): Presence {
		$row = $this->presence(80_000, 10_000);
		$row->setUid($uid);
		$row->setSession($session);
		$row->setName(ucfirst($uid));
		$row->setVoice($voice);
		$row->setTrajectory(json_encode(['id' => 0, 'points' => [$cell], 'arriveAt' => [0]]));
		return $row;
	}

	private function audioFile(int $id, string $name): File {
		$file = $this->createStub(File::class);
		$file->method('getId')->willReturn($id);
		$file->method('getName')->willReturn($name);
		return $file;
	}

	public function testMusicStartsAtThePlayerWithTheCallersCheckedFiles(): void {
		$here = $this->at('alice', [5, 17]);
		$this->presences->method('findByUidKey')->willReturnCallback(function () use (&$here) {
			return $here;
		});
		$this->presences->method('findByOffice')->willReturnCallback(function () use (&$here) {
			return [$here];
		});
		$this->music->method('file')->willReturnCallback(fn (string $uid, int $id) => $uid === 'alice' ? $this->audioFile($id, "Song $id.mp3") : throw ApiException::invalid('no'));
		$saved = [];
		$this->offices->method('updateRoomState')->willReturnCallback(function (int $id, string $state) use (&$saved) {
			$saved[] = json_decode($state, true)['music'];
		});
		$tracks = [['fileId' => 41, 'durationMs' => 500], ['fileId' => 42, 'durationMs' => 3_000_000]];
		try {
			$this->room->startMusic($this->user, $this->office, self::SESSION, $tracks);
			$this->fail('Started the music from the entrance');
		} catch (ApiException $e) {
			$this->assertSame('OUT_OF_REACH', $e->getApiCode());
		}

		// Next to the player at the sofa.
		$here = $this->at('alice', [11, 2]);
		$this->push->expects($this->once())->method('push')->with(['alice'], $this->callback(fn (array $batch) => $batch['events'][0]['kind'] === 'music'));
		$result = $this->room->startMusic($this->user, $this->office, self::SESSION, $tracks);
		$this->assertSame(['uid' => 'alice', 'name' => 'Alice', 'startedAt' => self::NOW, 'tracks' => [
			['title' => 'Song 41', 'durationMs' => RoomService::MUSIC_MIN_MS],
			['title' => 'Song 42', 'durationMs' => RoomService::MUSIC_MAX_MS],
		]], $result['music']);
		// File ids stay on the server.
		$this->assertSame([41, 42], array_column($saved[0]['tracks'], 'fileId'));
	}

	public function testMusicNeedsOneToTenValidTracks(): void {
		$here = $this->at('alice', [11, 2]);
		$this->presences->method('findByUidKey')->willReturn($here);
		$this->music->method('file')->willThrowException(ApiException::invalid('Choose audio files'));
		foreach ([[], array_fill(0, 11, ['fileId' => 1, 'durationMs' => 1000]), ['a' => ['fileId' => 1, 'durationMs' => 1000]], [['fileId' => '1', 'durationMs' => 1000]], [['fileId' => 1, 'durationMs' => 1000]]] as $tracks) {
			try {
				$this->room->startMusic($this->user, $this->office, self::SESSION, $tracks);
				$this->fail('Accepted ' . json_encode($tracks));
			} catch (ApiException $e) {
				$this->assertSame('INVALID_INPUT', $e->getApiCode());
			}
		}
	}

	public function testMusicStopsWhenThePersonWhoStartedItLeaves(): void {
		$this->office->setRoomState(json_encode(['music' => ['uid' => 'alice', 'name' => 'Alice', 'startedAt' => 1, 'tracks' => [['fileId' => 41, 'title' => 'Song', 'durationMs' => 1000]]]]));
		$row = $this->at('alice', [5, 17]);
		$this->presences->method('findByUidKey')->willReturn($row);
		$this->presences->method('findByOffice')->willReturn([]);
		$this->offices->expects($this->once())->method('updateRoomState')->with(7, $this->callback(fn (string $state) => json_decode($state, true)['music'] === null));
		$this->signals->expects($this->once())->method('deleteSession')->with(7, self::SESSION);
		$this->room->leave($this->user, $this->office, self::SESSION);
	}

	public function testMusicKeepsPlayingWhenSomeoneElseLeaves(): void {
		$this->office->setRoomState(json_encode(['music' => ['uid' => 'bao', 'name' => 'Bảo', 'startedAt' => 1, 'tracks' => [['fileId' => 41, 'title' => 'Song', 'durationMs' => 1000]]]]));
		$this->presences->method('findByUidKey')->willReturn($this->at('alice', [5, 17]));
		$this->presences->method('findByOffice')->willReturn([]);
		$this->offices->expects($this->never())->method('updateRoomState');
		$this->room->leave($this->user, $this->office, self::SESSION);
	}

	public function testAnyoneAtThePlayerStopsTheMusic(): void {
		$this->office->setRoomState(json_encode(['music' => ['uid' => 'bao', 'name' => 'Bảo', 'startedAt' => 1, 'tracks' => [['fileId' => 41, 'title' => 'Song', 'durationMs' => 1000]]]]));
		$row = $this->at('alice', [13, 2]);
		$this->presences->method('findByUidKey')->willReturn($row);
		$this->presences->method('findByOffice')->willReturn([$row]);
		$this->offices->expects($this->once())->method('updateRoomState')->with(7, $this->callback(fn (string $state) => json_decode($state, true)['music'] === null));
		$this->assertNull($this->room->stopMusic($this->user, $this->office, self::SESSION)['music']);
	}

	public function testTracksStreamOnlyToPeopleInsideWhileTheirOwnerIsThere(): void {
		$this->office->setRoomState(json_encode(['music' => ['uid' => 'bao', 'name' => 'Bảo', 'startedAt' => 1, 'tracks' => [['fileId' => 41, 'title' => 'Song', 'durationMs' => 1000]]]]));
		$alice = $this->at('alice', [5, 17]);
		$bao = $this->at('bao', [11, 2], 'ffffffffffffffffffffffffffffffff');
		$inside = ['alice' => $alice, 'bao' => $bao];
		$this->presences->method('findByUidKey')->willReturnCallback(function (string $key) use (&$inside) {
			foreach ($inside as $uid => $row) {
				if (RoomService::uidKey($uid) === $key) {
					return $row;
				}
			}
			return null;
		});
		$file = $this->audioFile(41, 'Song.mp3');
		$this->music->method('file')->willReturnCallback(fn (string $uid, int $id) => $uid === 'bao' && $id === 41 ? $file : throw ApiException::invalid('no'));

		$this->assertSame($file, $this->room->musicTrack($this->user, $this->office, 0));
		foreach ([[1, 'MUSIC_STOPPED'], [-1, 'MUSIC_STOPPED']] as [$index, $code]) {
			try {
				$this->room->musicTrack($this->user, $this->office, $index);
				$this->fail('Streamed track ' . $index);
			} catch (ApiException $e) {
				$this->assertSame($code, $e->getApiCode());
			}
		}
		unset($inside['bao']);
		try {
			$this->room->musicTrack($this->user, $this->office, 0);
			$this->fail('Streamed after the owner left');
		} catch (ApiException $e) {
			$this->assertSame('MUSIC_STOPPED', $e->getApiCode());
		}
		$inside = ['bao' => $bao];
		try {
			$this->room->musicTrack($this->user, $this->office, 0);
			$this->fail('Streamed to someone outside');
		} catch (ApiException $e) {
			$this->assertSame('NOT_PRESENT', $e->getApiCode());
		}
	}

	private const OTHER = 'ffffffffffffffffffffffffffffffff';

	/** Alice and Bảo inside; whether each has voice on. */
	private function voices(bool $alice, bool $bao): void {
		$me = $this->at('alice', [5, 17], self::SESSION, $alice);
		$other = $this->at('bao', [6, 17], self::OTHER, $bao);
		$this->presences->method('findByUidKey')->willReturn($me);
		$this->presences->method('findByOffice')->willReturn([$me, $other]);
	}

	public function testSignalsReachTheOtherTabByPushAndPoll(): void {
		$this->voices(true, true);
		$this->office->setToken(str_repeat('a', 32));
		$this->signals->expects($this->once())->method('insert')->willReturnCallback(function (Signal $signal) {
			$this->assertSame([7, self::OTHER, self::SESSION, '{"type":"offer","sdp":"v=0"}'], [$signal->getOfficeId(), $signal->getToSession(), $signal->getFromSession(), $signal->getBody()]);
			$signal->setId(99);
			return $signal;
		});
		$this->push->expects($this->once())->method('push')->with(['bao'], [
			'office' => str_repeat('a', 32),
			'id' => 99,
			'to' => self::OTHER,
			'from' => self::SESSION,
			'body' => ['type' => 'offer', 'sdp' => 'v=0'],
		], PushService::SIGNAL_MESSAGE);
		$this->assertSame(['id' => 99, 'serverTime' => self::NOW], $this->room->signal($this->user, $this->office, self::SESSION, self::OTHER, ['type' => 'offer', 'sdp' => 'v=0']));
	}

	/** @return array<string, array{0: bool, 1: bool, 2: bool, 3: string, 4: array, 5: string}> */
	public static function refusedSignals(): array {
		$offer = ['type' => 'offer', 'sdp' => 'v=0'];
		return [
			'voice is off for everyone' => [false, true, true, self::OTHER, $offer, 'ACTION_DENIED'],
			'the receiver has voice off' => [true, true, false, self::OTHER, $offer, 'PERSON_UNAVAILABLE'],
			'the sender has voice off' => [true, false, true, self::OTHER, $offer, 'ACTION_DENIED'],
			'nobody with that tab' => [true, true, true, 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee', $offer, 'PERSON_UNAVAILABLE'],
			'to yourself' => [true, true, true, self::SESSION, $offer, 'INVALID_INPUT'],
			'an unknown type' => [true, true, true, self::OTHER, ['type' => 'candidate', 'sdp' => 'x'], 'INVALID_INPUT'],
			'extra fields' => [true, true, true, self::OTHER, ['type' => 'bye', 'url' => 'x'], 'INVALID_INPUT'],
			'more than 16 KB' => [true, true, true, self::OTHER, ['type' => 'offer', 'sdp' => str_repeat('a', RoomService::SIGNAL_MAX_BYTES)], 'INVALID_INPUT'],
		];
	}

	#[\PHPUnit\Framework\Attributes\DataProvider('refusedSignals')]
	public function testSignalsAreRefused(bool $allowed, bool $alice, bool $bao, string $to, array $body, string $code): void {
		$this->voiceAllowed = $allowed;
		$this->voices($alice, $bao);
		$this->signals->expects($this->never())->method('insert');
		$this->push->expects($this->never())->method('push');
		try {
			$this->room->signal($this->user, $this->office, self::SESSION, $to, $body);
			$this->fail('Signal accepted');
		} catch (ApiException $e) {
			$this->assertSame($code, $e->getApiCode());
		}
	}

	public function testSignalsFromSomeoneOutsideAreRefused(): void {
		$this->presences->method('findByUidKey')->willReturn(null);
		$this->signals->expects($this->never())->method('insert');
		try {
			$this->room->signal($this->user, $this->office, self::SESSION, self::OTHER, ['type' => 'bye']);
			$this->fail('Signal accepted');
		} catch (ApiException $e) {
			$this->assertSame('NOT_PRESENT', $e->getApiCode());
		}
	}

	public function testThePollHandsOutWaitingSignalsOnce(): void {
		$this->voices(true, true);
		$signal = new Signal();
		$signal->setId(5);
		$signal->setFromSession(self::OTHER);
		$signal->setBody('{"type":"answer","sdp":"v=0"}');
		$this->signals->expects($this->once())->method('findFor')->with(7, self::SESSION)->willReturn([$signal]);
		$this->signals->expects($this->once())->method('deleteIds')->with([5]);
		$result = $this->room->poll($this->user, $this->office, self::SESSION, 3);
		$this->assertSame([['id' => 5, 'from' => self::OTHER, 'body' => ['type' => 'answer', 'sdp' => 'v=0']]], $result['signals']);
	}

	public function testThePollSkipsSignalsWithVoiceOff(): void {
		$this->voices(false, true);
		$this->signals->expects($this->never())->method('findFor');
		$this->assertArrayNotHasKey('signals', $this->room->poll($this->user, $this->office, self::SESSION, 3));
	}

	public function testVoiceTurnsOnOnlyWhenAllowedAndOffDropsWaitingSignals(): void {
		$this->voices(false, true);
		$this->voiceAllowed = false;
		try {
			$this->room->setVoice($this->user, $this->office, self::SESSION, true);
			$this->fail('Voice turned on against the admin setting');
		} catch (ApiException $e) {
			$this->assertSame('ACTION_DENIED', $e->getApiCode());
		}
		$this->voiceAllowed = true;
		$on = $this->room->setVoice($this->user, $this->office, self::SESSION, true);
		$this->assertSame(self::SESSION, $on['participant']['voice']);
		$this->signals->expects($this->once())->method('deleteSession')->with(7, self::SESSION);
		$this->assertNull($this->room->setVoice($this->user, $this->office, self::SESSION, false)['participant']['voice']);
	}

	public function testComingBackAfterATimeoutEntersAnewAndStopsTheOldMusic(): void {
		$this->office->setRoomState(json_encode(['music' => ['uid' => 'alice', 'name' => 'Alice', 'startedAt' => 1, 'tracks' => [['fileId' => 41, 'title' => 'Song', 'durationMs' => 1000]]]]));
		$expired = $this->at('alice', [11, 2]);
		$expired->setLeaseUntil(self::NOW - 1);
		$this->presences->method('findByUidKey')->willReturn($expired);
		$gone = false;
		$this->presences->method('findByOffice')->willReturnCallback(function () use (&$gone, $expired) {
			return $gone ? [] : [$expired];
		});
		$this->presences->expects($this->once())->method('delete')->with($expired)->willReturnCallback(function (Presence $row) use (&$gone) {
			$gone = true;
			return $row;
		});
		$this->presences->expects($this->never())->method('update');
		$this->presences->expects($this->once())->method('insert')->willReturnArgument(0);
		$saved = [];
		$this->offices->method('updateRoomState')->willReturnCallback(function (int $id, string $state) use (&$saved) {
			$decoded = json_decode($state, true);
			$saved[] = array_key_exists('music', $decoded) ? $decoded['music'] : 'unchanged';
		});
		$this->room->enter($this->user, $this->office, 'ffffffffffffffffffffffffffffffff', false);
		$this->assertSame([null], $saved);
	}
}
