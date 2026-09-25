<?php

declare(strict_types=1);

/**
 * SPDX-FileCopyrightText: 2026 Hoang Pham
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

namespace OCA\VirtualOffice\Tests\Service;

use OCA\VirtualOffice\Db\Office;
use OCA\VirtualOffice\Db\OfficeMapper;
use OCA\VirtualOffice\Service\AccessPolicy;
use OCA\VirtualOffice\Service\Catalog;
use OCA\VirtualOffice\Service\Clock;
use OCA\VirtualOffice\Service\ConversationService;
use OCA\VirtualOffice\Service\OfficeService;
use OCA\VirtualOffice\Service\RoomService;
use OCA\VirtualOffice\Service\Settings;
use OCA\VirtualOffice\Service\TalkService;
use OCP\IGroupManager;
use OCP\IL10N;
use OCP\IURLGenerator;
use OCP\IUser;
use OCP\IUserManager;
use OCP\Security\ISecureRandom;
use OCP\Teams\ITeamManager;
use OCP\Teams\ITeamResourceProvider;
use OCP\Teams\Team;
use OCP\Teams\TeamResource;
use PHPUnit\Framework\TestCase;

class OfficeServiceTest extends TestCase {
	private function office(int $id, string $title, string $kind): Office {
		$office = new Office();
		$office->setId($id);
		$office->setTitle($title);
		$office->setAudienceKind($kind);
		$office->setAudienceId($kind === 'talk' ? 'room' . $id : 'team1');
		return $office;
	}

	public function testPagesCoverEveryOfficeOnceWithCloseAudiencesFirst(): void {
		$teamOffices = [...array_map(fn (int $i) => $this->office($i, sprintf('Team office %02d', $i), 'team'), range(1, 60)), $this->office(200, 'Everyone', 'instance')];
		$talkOffices = [$this->office(101, 'Alpha chat', 'talk'), $this->office(102, 'Mid chat', 'talk'), $this->office(103, 'Zulu chat', 'talk'), $this->office(104, 'Not mine', 'talk')];
		$mapper = $this->createStub(OfficeMapper::class);
		$mapper->method('findByAudienceKeys')->willReturn($teamOffices);
		$mapper->method('findByKind')->willReturn($talkOffices);
		$policy = $this->createStub(AccessPolicy::class);
		$policy->method('isUsable')->willReturn(true);
		$policy->method('audienceKeysFor')->willReturn(['key']);
		$conversations = $this->createStub(ConversationService::class);
		$conversations->method('isAvailable')->willReturn(true);
		$conversations->method('isParticipant')->willReturnCallback(static fn (IUser $user, string $token) => $token !== 'room104');
		$service = new OfficeService($mapper, $policy, $this->createStub(RoomService::class), $this->createStub(TalkService::class), $conversations,
			new Catalog(), $this->createStub(Settings::class), $this->createStub(Clock::class), $this->createStub(ITeamManager::class),
			$this->createStub(IGroupManager::class), $this->createStub(IUserManager::class), $this->createStub(ISecureRandom::class),
			$this->createStub(IURLGenerator::class), $this->createStub(IL10N::class));
		$user = $this->createStub(IUser::class);

		$first = $service->listFor($user, '', 50, 0);
		$second = $service->listFor($user, '', 50, 50);
		$ids = array_map(static fn (Office $o) => $o->getId(), [...$first, ...$second]);
		$this->assertCount(50, $first);
		$this->assertCount(14, $second);
		$this->assertSame(64, count(array_unique($ids)));
		$this->assertNotContains(104, $ids);
		// Teams, then conversations, then the whole organization.
		$this->assertSame('Team office 01', $first[0]->getTitle());
		$this->assertSame('Alpha chat', $second[10]->getTitle());
		$this->assertSame('Zulu chat', $second[12]->getTitle());
		$this->assertSame('Everyone', $second[13]->getTitle());
	}

	private function service(OfficeMapper $mapper, AccessPolicy $policy, ConversationService $conversations, ITeamManager $teams, ?TalkService $talk = null): OfficeService {
		$urls = $this->createStub(IURLGenerator::class);
		$urls->method('linkToRouteAbsolute')->willReturnCallback(fn (string $route, array $p) => 'https://cloud/o/' . $p['token']);
		return new OfficeService($mapper, $policy, $this->createStub(RoomService::class), $talk ?? $this->createStub(TalkService::class), $conversations,
			new Catalog(), $this->createStub(Settings::class), $this->createStub(Clock::class), $teams,
			$this->createStub(IGroupManager::class), $this->createStub(IUserManager::class), $this->createStub(ISecureRandom::class),
			$urls, $this->createStub(IL10N::class));
	}

	private function provider(string $id): ITeamResourceProvider {
		$provider = $this->createStub(ITeamResourceProvider::class);
		$provider->method('getId')->willReturn($id);
		return $provider;
	}

	public function testTeamResourcesLeaveOutOfficesAndFillTheSlots(): void {
		$teams = $this->createStub(ITeamManager::class);
		$teams->method('hasTeamSupport')->willReturn(true);
		$resources = [new TeamResource($this->provider('virtualoffice'), 'o1', 'Some office', 'https://cloud/o/o1')];
		for ($i = 1; $i <= 8; $i++) {
			$resources[] = new TeamResource($this->provider('deck'), (string)$i, 'Board ' . $i, 'https://cloud/deck/' . $i, '<svg/>');
		}
		$teams->method('getSharedWith')->willReturn($resources);
		$service = $this->service($this->createStub(OfficeMapper::class), $this->createStub(AccessPolicy::class), $this->createStub(ConversationService::class), $teams);

		$listed = $service->teamResources($this->createStub(IUser::class), $this->office(1, 'Studio', 'team'));
		$this->assertCount(OfficeService::RESOURCE_SLOTS, $listed);
		$this->assertSame(['provider' => 'deck', 'id' => '1', 'label' => 'Board 1', 'url' => 'https://cloud/deck/1', 'iconUrl' => null, 'iconSvg' => '<svg/>', 'iconEmoji' => null], $listed[0]);
		$this->assertSame([], $service->teamResources($this->createStub(IUser::class), $this->office(2, 'Group', 'group')));
	}

	public function testAConversationPointsToTheOfficesOfItsTeams(): void {
		$teams = $this->createStub(ITeamManager::class);
		$teams->method('hasTeamSupport')->willReturn(true);
		$team = $this->createStub(Team::class);
		$team->method('getId')->willReturn('team1');
		$teams->method('getTeamsForResource')->willReturn([$team]);
		$mapper = $this->createStub(OfficeMapper::class);
		$mine = $this->office(1, 'Team room', 'team');
		$other = $this->office(2, 'Other', 'team');
		$other->setAudienceId('team2');
		$mapper->method('findByAudienceKeys')->willReturn([$mine, $other]);
		$mapper->method('findByKind')->willReturn([]);
		$policy = $this->createStub(AccessPolicy::class);
		$policy->method('audienceKeysFor')->willReturn(['key']);
		$conversations = $this->createStub(ConversationService::class);
		$conversations->method('isParticipant')->willReturnCallback(static fn (IUser $u, string $token) => $token === 'abcdefgh');
		$service = $this->service($mapper, $policy, $conversations, $teams);

		$mine->setToken('t1');
		$this->assertSame([['token' => 't1', 'title' => 'Team room', 'url' => 'https://cloud/o/t1']], $service->teamOfficesOf($this->createStub(IUser::class), 'abcdefgh'));
		$this->assertSame([], $service->teamOfficesOf($this->createStub(IUser::class), 'zzzzzzzz'));
	}

	public function testTheUsersOwnConversationsReplaceTheCappedScan(): void {
		$mapper = $this->createMock(OfficeMapper::class);
		$mapper->method('findByAudienceKeys')->willReturn([]);
		$mapper->expects($this->never())->method('findByKind');
		$old = $this->office(900, 'Old retro', 'talk');
		$mapper->expects($this->once())->method('findTalkByTokens')->with(['room900', 'room901'], '')->willReturn([$old, $this->office(901, 'Left', 'talk')]);
		$policy = $this->createStub(AccessPolicy::class);
		$policy->method('isUsable')->willReturn(true);
		$policy->method('audienceKeysFor')->willReturn([]);
		$conversations = $this->createStub(ConversationService::class);
		$conversations->method('isAvailable')->willReturn(true);
		// Tokens come from the browser, so participation is still checked.
		$conversations->method('isParticipant')->willReturnCallback(static fn (IUser $u, string $token) => $token === 'room900');
		$service = $this->service($mapper, $policy, $conversations, $this->createStub(ITeamManager::class));

		$this->assertSame([$old], $service->allFor($this->createStub(IUser::class), '', ['room900', 'room901', 'room900', 'no/good']));
	}

	public function testMembersGetTheConversationTokenOnlyWhileTheyCanOpenIt(): void {
		$office = $this->office(1, 'Studio', 'team');
		$office->setToken('t1');
		$office->setConfig(json_encode(['decor' => [], 'talk' => ['source' => 'team', 'token' => 'abcd1234', 'label' => 'Standup']]));
		$policy = $this->createStub(AccessPolicy::class);
		$policy->method('isMember')->willReturn(true);
		$talk = $this->createStub(TalkService::class);
		$talk->method('conversationUrl')->willReturnOnConsecutiveCalls('https://cloud/call/abcd1234', null);
		$service = $this->service($this->createStub(OfficeMapper::class), $policy, $this->createStub(ConversationService::class), $this->createStub(ITeamManager::class), $talk);
		$user = $this->createStub(IUser::class);

		$shared = $service->definition($user, $office);
		$this->assertSame('abcd1234', $shared['config']['talk']['token']);
		$this->assertSame(['chat' => 'https://cloud/call/abcd1234', 'call' => 'https://cloud/call/abcd1234#direct-call'], $shared['links']);
		$unshared = $service->definition($user, $office);
		$this->assertArrayNotHasKey('token', $unshared['config']['talk']);
	}
}
