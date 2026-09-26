<?php

declare(strict_types=1);

/**
 * SPDX-FileCopyrightText: 2026 Hoang Pham
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

namespace OCA\VirtualOffice\Tests\Service;

use OCA\VirtualOffice\Db\Office;
use OCA\VirtualOffice\Exception\ApiException;
use OCA\VirtualOffice\Service\AccessPolicy;
use OCA\VirtualOffice\Service\Catalog;
use OCA\VirtualOffice\Service\Clock;
use OCA\VirtualOffice\Service\ConversationService;
use OCA\VirtualOffice\Service\Settings;
use OCP\App\IAppManager;
use OCP\IAppConfig;
use OCP\IGroupManager;
use OCP\IUser;
use OCP\Teams\ITeamManager;
use OCP\Teams\Team;
use PHPUnit\Framework\MockObject\Stub;
use PHPUnit\Framework\TestCase;
use Psr\Log\NullLogger;

class AccessPolicyTest extends TestCase {
	private ITeamManager&Stub $teams;
	private IGroupManager&Stub $groups;
	private IAppConfig&Stub $appConfig;
	private AccessPolicy $policy;

	protected function setUp(): void {
		$this->teams = $this->createStub(ITeamManager::class);
		$this->teams->method('hasTeamSupport')->willReturn(true);
		$this->groups = $this->createStub(IGroupManager::class);
		$this->groups->method('isAdmin')->willReturnCallback(static fn (string $uid) => $uid === 'admin');
		$this->appConfig = $this->createStub(IAppConfig::class);
		$this->policy = $this->policyWith($this->teams);
	}

	private function policyWith(ITeamManager $teams, ?ConversationService $conversations = null): AccessPolicy {
		$apps = $this->createStub(IAppManager::class);
		$apps->method('isEnabledForUser')->willReturn(true);
		$clock = $this->createStub(Clock::class);
		$clock->method('nowMs')->willReturn(1_000_000);
		return new AccessPolicy($teams, $this->groups, $apps, new Settings($this->appConfig, new Catalog()), $clock, $conversations ?? $this->createStub(ConversationService::class), new NullLogger());
	}

	private function user(string $uid, bool $enabled = true): IUser&Stub {
		$user = $this->createStub(IUser::class);
		$user->method('getUID')->willReturn($uid);
		$user->method('isEnabled')->willReturn($enabled);
		return $user;
	}

	private function office(string $kind, string $id, array $managers = [], array $removals = []): Office {
		$office = new Office();
		$office->setAudienceKind($kind);
		$office->setAudienceId($id);
		$office->setManagers(json_encode($managers));
		$office->setRemovals(json_encode($removals, JSON_FORCE_OBJECT));
		return $office;
	}

	public function testTeamMembershipComesFromTheUsersTeams(): void {
		$this->teams->method('getTeamsForUser')->willReturnMap([
			['alice', [new Team('team1', 'Design', null)]],
			['chi', [new Team('other', 'Other', null)]],
		]);
		$office = $this->office('team', 'team1');
		$this->assertTrue($this->policy->isMember($this->user('alice'), $office));
		$this->assertFalse($this->policy->isMember($this->user('chi'), $office));
	}

	public function testTeamLookupIsNotUsedAsMembership(): void {
		$teams = $this->createMock(ITeamManager::class);
		$teams->method('hasTeamSupport')->willReturn(true);
		$teams->expects($this->once())->method('getTeamsForUser')->with('chi')->willReturn([]);
		$teams->expects($this->never())->method('getTeam');
		$teams->expects($this->never())->method('getMembersOfTeam');
		$this->assertFalse($this->policyWith($teams)->isMember($this->user('chi'), $this->office('team', 'team1')));
	}

	public function testFailingTeamBackendIsUnavailableNotEmpty(): void {
		$this->teams->method('getTeamsForUser')->willThrowException(new \RuntimeException('down'));
		try {
			$this->policy->isMember($this->user('alice'), $this->office('team', 'team1'));
			$this->fail('Expected unavailable');
		} catch (ApiException $e) {
			$this->assertSame('AUDIENCE_UNAVAILABLE', $e->getApiCode());
			$this->assertSame(503, $e->getHttpStatus());
		}
	}

	public function testFailingTeamBackendHidesTeamOfficesInDirectory(): void {
		$this->teams->method('getTeamsForUser')->willThrowException(new \RuntimeException('down'));
		$this->groups->method('getUserGroupIds')->willReturn(['staff']);
		$this->assertSame([AccessPolicy::audienceKey('group', 'staff')], $this->policy->audienceKeysFor($this->user('alice')));
	}

	public function testGroupMembership(): void {
		$this->groups->method('isInGroup')->willReturnMap([['alice', 'staff', true], ['chi', 'staff', false]]);
		$this->assertTrue($this->policy->isMember($this->user('alice'), $this->office('group', 'staff')));
		$this->assertFalse($this->policy->isMember($this->user('chi'), $this->office('group', 'staff')));
	}

	public function testInstanceOfficesFollowTheAdminSetting(): void {
		$this->appConfig->method('getValueBool')->willReturnOnConsecutiveCalls(false, true);
		$office = $this->office('instance', 'instance');
		$this->assertFalse($this->policy->isMember($this->user('alice'), $office));
		$this->assertTrue($this->policy->isMember($this->user('alice'), $office));
	}

	public function testDisabledAccountsAreNeverMembers(): void {
		$this->groups->method('isInGroup')->willReturn(true);
		$this->assertFalse($this->policy->isMember($this->user('disabled', false), $this->office('group', 'staff')));
	}

	public function testManagersMustStillBelongToTheAudience(): void {
		$this->groups->method('isInGroup')->willReturnMap([['alice', 'staff', true], ['bao', 'staff', false]]);
		$office = $this->office('group', 'staff', ['alice', 'bao']);
		$this->assertTrue($this->policy->canManage($this->user('alice'), $office));
		$this->assertFalse($this->policy->canManage($this->user('bao'), $office));
	}

	public function testAdminsManageButDoNotEnterOutsideTheAudience(): void {
		$this->groups->method('isInGroup')->willReturn(false);
		$office = $this->office('group', 'staff');
		$admin = $this->user('admin');
		$this->assertTrue($this->policy->canManage($admin, $office));
		$this->policy->assertVisible($admin, $office);
		$this->expectException(ApiException::class);
		$this->policy->assertCanEnter($admin, $office);
	}

	public function testNonMembersSeeNotFound(): void {
		$this->groups->method('isInGroup')->willReturn(false);
		try {
			$this->policy->assertVisible($this->user('chi'), $this->office('group', 'staff'));
			$this->fail('Expected not found');
		} catch (ApiException $e) {
			$this->assertSame(404, $e->getHttpStatus());
		}
	}

	public function testActiveRemovalBlocksEnteringUntilItExpires(): void {
		$this->groups->method('isInGroup')->willReturn(true);
		$office = $this->office('group', 'staff', [], ['bao' => 2_000_000, 'old' => 500_000]);
		$this->assertSame(2_000_000, $this->policy->removedUntil($office, 'bao'));
		$this->assertNull($this->policy->removedUntil($office, 'old'));
		$this->policy->assertCanEnter($this->user('old'), $office);
		// Removed people also get no knocks, arrival notifications or roulette pairs meanwhile.
		$this->assertFalse($this->policy->isWelcome($this->user('bao'), $office));
		$this->assertTrue($this->policy->isWelcome($this->user('old'), $office));
		try {
			$this->policy->assertCanEnter($this->user('bao'), $office);
			$this->fail('Expected removal');
		} catch (ApiException $e) {
			$this->assertSame('OFFICE_REMOVED', $e->getApiCode());
			$this->assertSame(['until' => 2_000_000], $e->getData());
		}
	}

	public function testAudienceKeysSeparateKindsAndKeepCase(): void {
		$this->assertNotSame(AccessPolicy::audienceKey('team', 'abc'), AccessPolicy::audienceKey('group', 'abc'));
		$this->assertNotSame(AccessPolicy::audienceKey('group', 'Staff'), AccessPolicy::audienceKey('group', 'staff'));
	}

	public function testConversationOfficesFollowTalkParticipants(): void {
		$conversations = $this->createStub(ConversationService::class);
		$conversations->method('isAvailable')->willReturn(true);
		$conversations->method('isParticipant')->willReturnCallback(static fn (IUser $user, string $token) => $user->getUID() === 'alice' && $token === 'abcd1234');
		$policy = $this->policyWith($this->teams, $conversations);
		$office = $this->office('talk', 'abcd1234');
		$this->assertTrue($policy->isMember($this->user('alice'), $office));
		$this->assertFalse($policy->isMember($this->user('chi'), $office));
	}

	public function testConversationOfficesNeedTalk(): void {
		$conversations = $this->createStub(ConversationService::class);
		$conversations->method('isAvailable')->willReturn(false);
		try {
			$this->policyWith($this->teams, $conversations)->isMember($this->user('alice'), $this->office('talk', 'abcd1234'));
			$this->fail('Expected unavailable');
		} catch (ApiException $e) {
			$this->assertSame('AUDIENCE_UNAVAILABLE', $e->getApiCode());
		}
	}

	public function testAdminsStillManageConversationOfficesWhileTalkIsDown(): void {
		$conversations = $this->createStub(ConversationService::class);
		$conversations->method('isAvailable')->willReturn(false);
		$policy = $this->policyWith($this->teams, $conversations);
		$office = $this->office('talk', 'abcd1234');
		$policy->assertVisible($this->user('admin'), $office);
		$this->assertTrue($policy->canManage($this->user('admin'), $office));
		$this->expectException(ApiException::class);
		$policy->assertCanEnter($this->user('admin'), $office);
	}
}
