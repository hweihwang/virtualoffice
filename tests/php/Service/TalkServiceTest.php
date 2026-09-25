<?php

declare(strict_types=1);

/**
 * SPDX-FileCopyrightText: 2026 Hoang Pham
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

namespace OCA\VirtualOffice\Tests\Service;

use OCA\VirtualOffice\Db\Office;
use OCA\VirtualOffice\Exception\ApiException;
use OCA\VirtualOffice\Service\TalkService;
use OCP\IURLGenerator;
use OCP\IUser;
use OCP\Talk\IBroker;
use OCP\Teams\ITeamManager;
use OCP\Teams\ITeamResourceProvider;
use OCP\Teams\TeamResource;
use PHPUnit\Framework\TestCase;
use Psr\Log\NullLogger;

class TalkServiceTest extends TestCase {
	private function service(bool $talk = true, array $resources = []): TalkService {
		$broker = $this->createStub(IBroker::class);
		$broker->method('hasBackend')->willReturn($talk);
		$broker->method('isEnabledForUser')->willReturn($talk);
		$teams = $this->createStub(ITeamManager::class);
		$teams->method('getSharedWith')->willReturn($resources);
		$urls = $this->createStub(IURLGenerator::class);
		$urls->method('getAbsoluteURL')->willReturn('https://cloud.example.test/');
		$urls->method('linkToRouteAbsolute')->willReturnCallback(static fn ($route, $args) => 'https://cloud.example.test/call/' . $args['token']);
		return new TalkService($broker, $teams, $urls, new NullLogger());
	}

	private function office(string $kind, ?array $talk = null): Office {
		$office = new Office();
		$office->setAudienceKind($kind);
		$office->setAudienceId('team1');
		$office->setConfig(json_encode(['decor' => [], 'talk' => $talk]));
		return $office;
	}

	private function resource(string $provider, string $id, string $label): TeamResource {
		$p = $this->createStub(ITeamResourceProvider::class);
		$p->method('getId')->willReturn($provider);
		return new TeamResource($p, $id, $label, 'https://cloud.example.test/x');
	}

	public function testParsesTokensAndSameInstanceLinksOnly(): void {
		$talk = $this->service();
		$this->assertSame('abcd1234', $talk->parseConversationToken('abcd1234'));
		$this->assertSame('abcd1234', $talk->parseConversationToken('https://cloud.example.test/index.php/call/abcd1234'));
		$this->assertSame('abcd1234', $talk->parseConversationToken(' https://cloud.example.test/call/abcd1234/ '));
		$this->assertNull($talk->parseConversationToken('https://evil.example/call/abcd1234'));
		$this->assertNull($talk->parseConversationToken('https://cloud.example.test.evil/call/abcd1234'));
		$this->assertNull($talk->parseConversationToken('javascript:alert(1)'));
		$this->assertNull($talk->parseConversationToken('ABCD'));
	}

	public function testTeamBindingMustBeSharedWithTheTeam(): void {
		$talk = $this->service(true, [$this->resource('talk', 'room1abc', 'Standup'), $this->resource('deck', 'board', 'Board')]);
		$user = $this->createStub(IUser::class);
		$office = $this->office('team');
		$this->assertSame(['source' => 'team', 'token' => 'room1abc', 'label' => 'Standup'], $talk->validateBinding($user, $office, ['source' => 'team', 'token' => 'room1abc']));
		$this->expectException(ApiException::class);
		$talk->validateBinding($user, $office, ['source' => 'team', 'token' => 'board']);
	}

	public function testLinkBindingNeedsAName(): void {
		$talk = $this->service();
		$user = $this->createStub(IUser::class);
		$office = $this->office('group');
		$this->assertSame(['source' => 'link', 'token' => 'abcd1234', 'label' => 'Lounge'], $talk->validateBinding($user, $office, ['source' => 'link', 'url' => 'https://cloud.example.test/call/abcd1234', 'label' => " Lounge\u{0007}"]));
		$this->assertNull($talk->validateBinding($user, $office, null));
		foreach ([['source' => 'link', 'url' => 'abcd1234', 'label' => ''], ['source' => 'link', 'url' => 'x', 'label' => 'A'], ['source' => 'other'], ['source' => 'link', 'url' => 'abcd1234', 'label' => 'A', 'extra' => 1]] as $bad) {
			try {
				$talk->validateBinding($user, $office, $bad);
				$this->fail('Accepted ' . json_encode($bad));
			} catch (ApiException $e) {
				$this->assertSame('INVALID_INPUT', $e->getApiCode());
			}
		}
	}

	public function testConversationUrlDisappearsWhenTalkOrSharingIsGone(): void {
		$user = $this->createStub(IUser::class);
		$office = $this->office('team', ['source' => 'team', 'token' => 'room1abc', 'label' => 'Standup']);
		$this->assertSame('https://cloud.example.test/call/room1abc', $this->service(true, [$this->resource('talk', 'room1abc', 'Standup')])->conversationUrl($user, $office));
		$this->assertNull($this->service(true, [])->conversationUrl($user, $office));
		$this->assertNull($this->service(false, [$this->resource('talk', 'room1abc', 'Standup')])->conversationUrl($user, $office));
		$link = $this->office('group', ['source' => 'link', 'token' => 'abcd1234', 'label' => 'Lounge']);
		$this->assertSame('https://cloud.example.test/call/abcd1234', $this->service()->conversationUrl($user, $link));
		$this->assertNull($this->service()->conversationUrl($user, $this->office('group')));
	}
}
