<?php

declare(strict_types=1);

/**
 * SPDX-FileCopyrightText: 2026 Hoang Pham
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

namespace OCA\VirtualOffice\Tests\Command;

use OCA\VirtualOffice\AppInfo\Application;
use OCA\VirtualOffice\Command\Purge;
use OCP\Config\IUserConfig;
use OCP\DB\QueryBuilder\IQueryBuilder;
use OCP\IAppConfig;
use OCP\IDBConnection;
use OCP\Notification\IManager as INotificationManager;
use OCP\Notification\INotification;
use PHPUnit\Framework\TestCase;
use Symfony\Component\Console\Tester\CommandTester;

class PurgeTest extends TestCase {
	public function testDeletesEveryAppTableAndConfig(): void {
		$deleted = [];
		$query = $this->createStub(IQueryBuilder::class);
		$query->method('delete')->willReturnCallback(function (string $table) use (&$deleted, &$query): IQueryBuilder {
			$deleted[] = $table;
			return $query;
		});
		$query->method('executeStatement')->willReturn(1);
		$db = $this->createStub(IDBConnection::class);
		$db->method('getQueryBuilder')->willReturn($query);
		$appConfig = $this->createMock(IAppConfig::class);
		$appConfig->expects($this->once())->method('deleteApp')->with(Application::APP_ID);
		$userConfig = $this->createMock(IUserConfig::class);
		$userConfig->expects($this->once())->method('deleteApp')->with(Application::APP_ID);
		$notification = $this->createMock(INotification::class);
		$notification->expects($this->once())->method('setApp')->with(Application::APP_ID)->willReturnSelf();
		$notifications = $this->createMock(INotificationManager::class);
		$notifications->expects($this->once())->method('createNotification')->willReturn($notification);
		$notifications->expects($this->once())->method('markProcessed')->with($notification);

		$tester = new CommandTester(new Purge($db, $appConfig, $userConfig, $notifications));
		$this->assertSame(0, $tester->execute(['--force' => true]));
		$this->assertSame(['vo_knocks', 'vo_watches', 'vo_roulette', 'vo_desks', 'vo_presence', 'vo_offices'], $deleted);
	}

	public function testRequiresExplicitConfirmation(): void {
		$db = $this->createMock(IDBConnection::class);
		$db->expects($this->never())->method('getQueryBuilder');
		$appConfig = $this->createMock(IAppConfig::class);
		$appConfig->expects($this->never())->method('deleteApp');
		$userConfig = $this->createMock(IUserConfig::class);
		$userConfig->expects($this->never())->method('deleteApp');
		$notifications = $this->createMock(INotificationManager::class);
		$notifications->expects($this->never())->method('markProcessed');

		$tester = new CommandTester(new Purge($db, $appConfig, $userConfig, $notifications));
		$this->assertSame(1, $tester->execute([]));
	}
}
