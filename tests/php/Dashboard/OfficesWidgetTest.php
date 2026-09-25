<?php

declare(strict_types=1);

/**
 * SPDX-FileCopyrightText: 2026 Hoang Pham
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

namespace OCA\VirtualOffice\Tests\Dashboard;

use OCA\VirtualOffice\Dashboard\OfficesWidget;
use OCA\VirtualOffice\Db\Desk;
use OCA\VirtualOffice\Db\DeskMapper;
use OCA\VirtualOffice\Db\Office;
use OCA\VirtualOffice\Db\OfficeMapper;
use OCA\VirtualOffice\Service\AccessPolicy;
use OCA\VirtualOffice\Service\RoomService;
use OCP\IL10N;
use OCP\IURLGenerator;
use OCP\IUser;
use OCP\IUserManager;
use PHPUnit\Framework\TestCase;

class OfficesWidgetTest extends TestCase {
	private function office(int $id, string $title): Office {
		$office = new Office();
		$office->setId($id);
		$office->setTitle($title);
		$office->setToken(str_pad((string)$id, 32, 'a'));
		return $office;
	}

	public function testBusiestOfficesFirstThenYourDesksOnlyWhereYouBelong(): void {
		$other = $this->office(1, 'Not mine');
		$busy = $this->office(2, 'Busy');
		$small = $this->office(3, 'Small');
		$desk = $this->office(4, 'My desk');
		$l = $this->createStub(IL10N::class);
		$l->method('t')->willReturnArgument(0);
		$l->method('n')->willReturnCallback(fn (string $single, string $plural, int $count, array $params) => vsprintf($plural, $params));
		$users = $this->createStub(IUserManager::class);
		$users->method('get')->willReturn($this->createStub(IUser::class));
		$offices = $this->createStub(OfficeMapper::class);
		$offices->method('findByIds')->willReturnCallback(fn (array $ids) => array_values(array_filter([$other, $busy, $small, $desk], fn (Office $o) => in_array($o->getId(), $ids, true))));
		$policy = $this->createStub(AccessPolicy::class);
		$policy->method('isMember')->willReturnCallback(fn (IUser $u, Office $o) => $o !== $other);
		$room = $this->createStub(RoomService::class);
		$room->method('activeOfficeIds')->willReturn([1, 2, 3]);
		$room->method('counts')->willReturn([$busy->getToken() => 4, $small->getToken() => 1]);
		$room->method('present')->willReturnCallback(fn (Office $o) => $o === $busy
			? [['uid' => 'alice', 'name' => 'Alice'], ['uid' => 'chi', 'name' => 'Chi'], ['uid' => 'dan', 'name' => 'Dan'], ['uid' => 'eve', 'name' => 'Eve']]
			: [['uid' => 'bao', 'name' => 'Bảo']]);
		$mine = new Desk();
		$mine->setOfficeId(4);
		$desks = $this->createStub(DeskMapper::class);
		$desks->method('findByUidKey')->willReturn([$mine]);
		$urls = $this->createStub(IURLGenerator::class);
		$urls->method('linkToRouteAbsolute')->willReturnCallback(fn (string $route, array $p = []) => $route . ':' . ($p['token'] ?? $p['userId'] ?? ''));

		$items = (new OfficesWidget($l, $urls, $users, $offices, $policy, $room, $desks))->getItemsV2('me')->getItems();
		$this->assertSame(['Busy', 'Small', 'My desk'], array_map(fn ($i) => $i->getTitle(), $items));
		$this->assertSame('Alice, Chi and 2 more', $items[0]->getSubtitle());
		$this->assertSame('core.avatar.getAvatar:alice', $items[0]->getIconUrl());
		$this->assertSame('Bảo', $items[1]->getSubtitle());
		$this->assertSame('virtualoffice.page.office:' . $desk->getToken(), $items[2]->getLink());
	}
}
