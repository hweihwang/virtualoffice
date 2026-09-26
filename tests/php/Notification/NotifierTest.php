<?php

declare(strict_types=1);

/**
 * SPDX-FileCopyrightText: 2026 Hoang Pham
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

namespace OCA\VirtualOffice\Tests\Notification;

use OCA\VirtualOffice\Db\Knock;
use OCA\VirtualOffice\Db\KnockMapper;
use OCA\VirtualOffice\Db\Office;
use OCA\VirtualOffice\Db\OfficeMapper;
use OCA\VirtualOffice\Db\Presence;
use OCA\VirtualOffice\Db\PresenceMapper;
use OCA\VirtualOffice\Notification\Notifier;
use OCA\VirtualOffice\Service\Clock;
use OCA\VirtualOffice\Service\KnockService;
use OCP\IL10N;
use OCP\IURLGenerator;
use OCP\IUserManager;
use OCP\L10N\IFactory;
use OCP\Notification\AlreadyProcessedException;
use OCP\Notification\IAction;
use OCP\Notification\INotification;
use OCP\Notification\UnknownNotificationException;
use PHPUnit\Framework\Attributes\AllowMockObjectsWithoutExpectations;
use PHPUnit\Framework\MockObject\Stub;
use PHPUnit\Framework\TestCase;

#[AllowMockObjectsWithoutExpectations]
class NotifierTest extends TestCase {
	private const NOW = 1_800_000_000_000;

	private KnockMapper&Stub $knocks;
	private PresenceMapper&Stub $presences;
	private Notifier $notifier;

	protected function setUp(): void {
		$l = $this->createStub(IL10N::class);
		$l->method('t')->willReturnCallback(fn (string $text, array $params = []) => vsprintf($text, $params));
		$factory = $this->createStub(IFactory::class);
		$factory->method('get')->willReturn($l);
		$office = new Office();
		$office->setToken(str_repeat('a', 32));
		$office->setTitle('Studio');
		$office->setId(7);
		$offices = $this->createStub(OfficeMapper::class);
		$offices->method('findByToken')->willReturn($office);
		$users = $this->createStub(IUserManager::class);
		$users->method('getDisplayName')->willReturn('Alice');
		$this->knocks = $this->createStub(KnockMapper::class);
		$this->presences = $this->createStub(PresenceMapper::class);
		$knockService = $this->createStub(KnockService::class);
		$knockService->method('callLink')->willReturn('https://cloud/call');
		$clock = $this->createStub(Clock::class);
		$clock->method('nowMs')->willReturn(self::NOW);
		$this->notifier = new Notifier($factory, $this->createStub(IURLGenerator::class), $users, $offices, $this->knocks, $this->presences, $knockService, $clock);
	}

	/** @param list<IAction> $actions */
	private function notification(string $subject, array $params, int $at = self::NOW, array $actions = []): INotification&Stub {
		$notification = $this->createStub(INotification::class);
		$notification->method('getApp')->willReturn('virtualoffice');
		$notification->method('getSubject')->willReturn($subject);
		$notification->method('getSubjectParameters')->willReturn($params + ['office' => str_repeat('a', 32), 'from' => 'alice']);
		$notification->method('getObjectId')->willReturn('5');
		$notification->method('getDateTime')->willReturn(new \DateTime('@' . intdiv($at, 1000)));
		$notification->method('getActions')->willReturn($actions);
		$notification->method('createAction')->willReturnCallback(function () {
			$action = $this->createStub(IAction::class);
			foreach (['setParsedLabel', 'setLink', 'setPrimary'] as $method) {
				$action->method($method)->willReturnSelf();
			}
			return $action;
		});
		foreach (['setIcon', 'setParsedMessage', 'setParsedSubject', 'setRichSubject', 'setLink', 'addParsedAction'] as $method) {
			$notification->method($method)->willReturnSelf();
		}
		return $notification;
	}

	public function testAnOpenKnockOffersTranslatedAnswers(): void {
		$this->knocks->method('findById')->willReturn(new Knock());
		$now = $this->createMock(IAction::class);
		$now->method('getLabel')->willReturn('now');
		$now->expects($this->once())->method('setParsedLabel')->with('Now')->willReturnSelf();
		$notification = $this->notification('knock', [], self::NOW, [$now]);
		$this->assertSame($notification, $this->notifier->prepare($notification, 'en'));
	}

	public function testAnsweredOrOldNotificationsDisappear(): void {
		$this->knocks->method('findById')->willReturn(null);
		foreach ([$this->notification('knock', []), $this->notification('knock_answer', ['answer' => 'now'], self::NOW - KnockService::EXPIRY_MS - 1000)] as $notification) {
			try {
				$this->notifier->prepare($notification, 'en');
				$this->fail('Still shown');
			} catch (AlreadyProcessedException) {
				$this->addToAssertionCount(1);
			}
		}
	}

	public function testAnArrivalShowsOnlyWhileThePersonIsStillThere(): void {
		$here = new Presence();
		$here->setOfficeId(7);
		$this->presences->method('findByUidKey')->willReturnOnConsecutiveCalls($here, null);
		$notification = $this->notification('arrival', []);
		$this->assertSame($notification, $this->notifier->prepare($notification, 'en'));
		$this->expectException(AlreadyProcessedException::class);
		$this->notifier->prepare($this->notification('arrival', []), 'en');
	}

	public function testOtherNotificationsAreNotOurs(): void {
		$this->expectException(UnknownNotificationException::class);
		$this->notifier->prepare($this->notification('something', []), 'en');
	}
}
