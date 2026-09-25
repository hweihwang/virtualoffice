<?php

declare(strict_types=1);

/**
 * SPDX-FileCopyrightText: 2026 Hoang Pham
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

namespace OCA\VirtualOffice\Tests\Service;

use OCA\VirtualOffice\Db\Knock;
use OCA\VirtualOffice\Db\KnockMapper;
use OCA\VirtualOffice\Db\Office;
use OCA\VirtualOffice\Db\OfficeMapper;
use OCA\VirtualOffice\Exception\ApiException;
use OCA\VirtualOffice\Service\AccessPolicy;
use OCA\VirtualOffice\Service\Clock;
use OCA\VirtualOffice\Service\ConversationService;
use OCA\VirtualOffice\Service\KnockService;
use OCA\VirtualOffice\Service\PushService;
use OCP\DB\Exception as DBException;
use OCP\IURLGenerator;
use OCP\IUser;
use OCP\IUserManager;
use OCP\Notification\IAction;
use OCP\Notification\IManager;
use OCP\Notification\INotification;
use PHPUnit\Framework\Attributes\AllowMockObjectsWithoutExpectations;
use PHPUnit\Framework\MockObject\MockObject;
use PHPUnit\Framework\MockObject\Stub;
use PHPUnit\Framework\TestCase;

#[AllowMockObjectsWithoutExpectations]
class KnockServiceTest extends TestCase {
	private const NOW = 9_000_000;

	private KnockMapper&MockObject $knocks;
	private AccessPolicy&MockObject $policy;
	private IManager&MockObject $notifications;
	private PushService&MockObject $push;
	private ConversationService&Stub $conversations;
	private KnockService $service;
	private Office $office;
	/** @var array<string, IUser> */
	private array $users = [];
	/** @var list<INotification&MockObject> */
	private array $created = [];
	/** @var list<array{0: string, 1: string}> action links and types */
	private array $links = [];

	protected function setUp(): void {
		$this->knocks = $this->createMock(KnockMapper::class);
		$this->policy = $this->createMock(AccessPolicy::class);
		$this->notifications = $this->createMock(IManager::class);
		$this->push = $this->createMock(PushService::class);
		$this->conversations = $this->createStub(ConversationService::class);
		$offices = $this->createStub(OfficeMapper::class);
		$this->office = new Office();
		$this->office->setId(7);
		$this->office->setToken(str_repeat('a', 32));
		$offices->method('findById')->willReturn($this->office);
		foreach (['alice', 'bao', 'chi'] as $uid) {
			$user = $this->createStub(IUser::class);
			$user->method('getUID')->willReturn($uid);
			$user->method('getDisplayName')->willReturn(ucfirst($uid));
			$this->users[$uid] = $user;
		}
		$userManager = $this->createStub(IUserManager::class);
		$userManager->method('get')->willReturnCallback(fn (string $uid) => $this->users[$uid] ?? null);
		$urls = $this->createStub(IURLGenerator::class);
		$urls->method('linkToOCSRouteAbsolute')->willReturn('https://cloud/ocs/knocks/5');
		$urls->method('linkTo')->willReturn('/index.php');
		$urls->method('getAbsoluteURL')->willReturnCallback(fn (string $url) => 'https://cloud' . $url);
		$urls->method('linkToRouteAbsolute')->willReturnCallback(fn (string $route, array $p) => 'https://cloud/apps/virtualoffice/o/office' . (isset($p['knock']) ? '?knock=' . $p['knock'] . '&answer=' . $p['answer'] : ''));
		$this->notifications->method('createNotification')->willReturnCallback(function () {
			$notification = $this->createMock(INotification::class);
			foreach (['setApp', 'setUser', 'setDateTime', 'setObject', 'setSubject', 'addAction'] as $method) {
				$notification->method($method)->willReturnSelf();
			}
			$notification->method('createAction')->willReturnCallback(function () {
				$action = $this->createStub(IAction::class);
				foreach (['setLabel', 'setPrimary'] as $method) {
					$action->method($method)->willReturnSelf();
				}
				$action->method('setLink')->willReturnCallback(function (string $link, string $type) use ($action) {
					$this->links[] = [$link, $type];
					return $action;
				});
				return $action;
			});
			$this->created[] = $notification;
			return $notification;
		});
		$clock = $this->createStub(Clock::class);
		$clock->method('nowMs')->willReturn(self::NOW);
		$this->service = new KnockService($this->knocks, $offices, $this->policy, $userManager, $this->notifications, $urls, $this->conversations, $this->push, $clock);
	}

	private function knockRow(string $from = 'alice', string $to = 'bao'): Knock {
		$knock = new Knock();
		$knock->setId(5);
		$knock->setOfficeId(7);
		$knock->setFromUid($from);
		$knock->setToUid($to);
		return $knock;
	}

	public function testKnockNotifiesAndPushesOnlyTheOtherPerson(): void {
		$this->policy->method('isWelcome')->willReturn(true);
		$this->knocks->expects($this->once())->method('insert')->willReturnCallback(function (Knock $k) {
			$k->setId(5);
			return $k;
		});
		$this->notifications->expects($this->once())->method('notify');
		$this->push->expects($this->once())->method('push')->with(['bao'], $this->callback(fn (array $b) => $b['kind'] === 'knock' && $b['from'] === 'alice' && $b['id'] === 5), PushService::KNOCK_MESSAGE);
		$this->assertSame(['id' => 5], $this->service->knock($this->users['alice'], $this->office, 'bao'));
		// Notifications only follows web links, so "Now" goes through the office page.
		$this->assertSame([
			['https://cloud/apps/virtualoffice/o/office?knock=5&answer=now', IAction::TYPE_WEB],
			['https://cloud/ocs/knocks/5?answer=soon', IAction::TYPE_POST],
			['https://cloud/ocs/knocks/5?answer=later', IAction::TYPE_POST],
		], $this->links);
	}

	public function testNobodyKnocksOnThemselvesOrOnOutsiders(): void {
		$this->policy->method('isWelcome')->willReturnCallback(fn (IUser $u) => $u->getUID() !== 'chi');
		$this->knocks->expects($this->never())->method('insert');
		foreach (['alice', 'chi', 'nobody', null] as $to) {
			try {
				$this->service->knock($this->users['alice'], $this->office, $to);
				$this->fail('Knocked on ' . var_export($to, true));
			} catch (ApiException $e) {
				$this->assertSame('PERSON_UNAVAILABLE', $e->getApiCode());
			}
		}
	}

	public function testKnockerWithoutAccessIsRefused(): void {
		$this->policy->method('assertCanEnter')->willThrowException(ApiException::unavailable());
		$this->expectException(ApiException::class);
		$this->service->knock($this->users['chi'], $this->office, 'bao');
	}

	public function testASecondKnockWaitsForTheAnswer(): void {
		$this->policy->method('isWelcome')->willReturn(true);
		$this->knocks->method('insert')->willThrowException(new class('duplicate') extends DBException {
			public function getReason(): ?int {
				return self::REASON_UNIQUE_CONSTRAINT_VIOLATION;
			}
		});
		$this->notifications->expects($this->never())->method('notify');
		try {
			$this->service->knock($this->users['alice'], $this->office, 'bao');
			$this->fail('Knocked twice');
		} catch (ApiException $e) {
			$this->assertSame('KNOCK_PENDING', $e->getApiCode());
		}
	}

	public function testOnlyThePersonAskedAnswers(): void {
		$this->knocks->method('findById')->willReturn($this->knockRow());
		$this->knocks->expects($this->never())->method('delete');
		try {
			$this->service->answer($this->users['chi'], 5, 'now');
			$this->fail('Answered for someone else');
		} catch (ApiException $e) {
			$this->assertSame('KNOCK_GONE', $e->getApiCode());
		}
		$this->expectException(ApiException::class);
		$this->service->answer($this->users['bao'], 5, 'tomorrow');
	}

	public function testNowOpensACallForBothWithTalk(): void {
		$this->conversations->method('isAvailable')->willReturn(true);
		$this->knocks->method('findById')->willReturn($this->knockRow());
		$this->knocks->expects($this->once())->method('delete');
		$this->notifications->expects($this->once())->method('markProcessed');
		$this->notifications->expects($this->once())->method('notify');
		$this->push->expects($this->once())->method('push')->with(['alice'], $this->callback(fn (array $b) => $b['answer'] === 'now' && $b['link'] === 'https://cloud/index.php/apps/spreed/?callUser=bao#direct-call'), PushService::KNOCK_MESSAGE);
		$this->assertSame(['link' => 'https://cloud/index.php/apps/spreed/?callUser=alice#direct-call'], $this->service->answer($this->users['bao'], 5, 'now'));
	}

	public function testWithoutTalkNowLeadsToTheOffice(): void {
		$this->conversations->method('isAvailable')->willReturn(false);
		$this->knocks->method('findById')->willReturn($this->knockRow());
		$this->assertSame(['link' => 'https://cloud/apps/virtualoffice/o/office'], $this->service->answer($this->users['bao'], 5, 'now'));
		$this->assertSame(['link' => null], $this->service->answer($this->users['bao'], 5, 'later'));
	}

	public function testUnansweredKnocksExpireWithTheirNotifications(): void {
		$this->knocks->expects($this->once())->method('findCreatedBefore')->with(self::NOW - KnockService::EXPIRY_MS)->willReturn([$this->knockRow(), $this->knockRow('chi')]);
		$this->knocks->expects($this->exactly(2))->method('delete');
		$this->notifications->expects($this->exactly(2))->method('markProcessed');
		$this->assertSame(2, $this->service->expire());
	}
}
