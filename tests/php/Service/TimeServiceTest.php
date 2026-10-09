<?php

declare(strict_types=1);

/**
 * SPDX-FileCopyrightText: 2026 Hoang Pham
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

namespace OCA\VirtualOffice\Tests\Service;

use OCA\VirtualOffice\Service\TimeService;
use OCP\Config\IUserConfig;
use OCP\DB\IResult;
use OCP\DB\QueryBuilder\IExpressionBuilder;
use OCP\DB\QueryBuilder\IQueryBuilder;
use OCP\IDBConnection;
use PHPUnit\Framework\TestCase;

class TimeServiceTest extends TestCase {
	/** As Personal settings › Availability saves it: Mon to Thu 08:30 to 12:00 and 13:00 to 16:30, Friday 10:00 to 14:00. */
	private const AVAILABILITY = "BEGIN:VCALENDAR\r\nPRODID:Nextcloud DAV app\r\nBEGIN:VTIMEZONE\r\nTZID:Asia/Ho_Chi_Minh\r\nBEGIN:STANDARD\r\nTZOFFSETFROM:+0700\r\nTZOFFSETTO:+0700\r\nTZNAME:+07\r\nDTSTART:19700101T000000\r\nEND:STANDARD\r\nEND:VTIMEZONE\r\nBEGIN:VAVAILABILITY\r\n"
		. "BEGIN:AVAILABLE\r\nDTSTART;TZID=Asia/Ho_Chi_Minh:20240101T083000\r\nDTEND;TZID=Asia/Ho_Chi_Minh:20240101T120000\r\nUID:a1\r\nRRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH\r\nEND:AVAILABLE\r\n"
		. "BEGIN:AVAILABLE\r\nDTSTART;TZID=Asia/Ho_Chi_Minh:20240101T130000\r\nDTEND;TZID=Asia/Ho_Chi_Minh:20240101T163000\r\nUID:a2\r\nRRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH\r\nEND:AVAILABLE\r\n"
		. "BEGIN:AVAILABLE\r\nDTSTART;TZID=Asia/Ho_Chi_Minh:20240105T100000\r\nDTEND;TZID=Asia/Ho_Chi_Minh:20240105T140000\r\nUID:a3\r\nRRULE:FREQ=WEEKLY;BYDAY=FR\r\nEND:AVAILABLE\r\n"
		. "END:VAVAILABILITY\r\nEND:VCALENDAR\r\n";

	public function testAvailabilityBecomesWeeklyRanges(): void {
		$hours = TimeService::parseAvailability(self::AVAILABILITY);
		$this->assertSame('Asia/Ho_Chi_Minh', $hours['timeZone']);
		$this->assertFalse($hours['default']);
		$this->assertSame([[510, 720], [780, 990]], $hours['days'][1]);
		$this->assertSame([[510, 720], [780, 990]], $hours['days'][4]);
		$this->assertSame([[600, 840]], $hours['days'][5]);
		$this->assertSame([], $hours['days'][6]);
		$this->assertSame([], $hours['days'][7]);
	}

	public function testANightShiftEndsAfterMidnight(): void {
		$ics = "BEGIN:VCALENDAR\r\nBEGIN:VAVAILABILITY\r\nBEGIN:AVAILABLE\r\nDTSTART;TZID=Europe/Berlin:20240101T220000\r\nDTEND;TZID=Europe/Berlin:20240102T060000\r\nUID:n\r\nRRULE:FREQ=WEEKLY;BYDAY=SU\r\nEND:AVAILABLE\r\nEND:VAVAILABILITY\r\nEND:VCALENDAR\r\n";
		$hours = TimeService::parseAvailability($ics);
		$this->assertSame('Europe/Berlin', $hours['timeZone']);
		$this->assertSame([[1320, 1800]], $hours['days'][7]);
	}

	public function testNothingUsableMeansNoHours(): void {
		$this->assertNull(TimeService::parseAvailability('not a calendar'));
		$this->assertNull(TimeService::parseAvailability("BEGIN:VCALENDAR\r\nBEGIN:VAVAILABILITY\r\nEND:VAVAILABILITY\r\nEND:VCALENDAR\r\n"));
	}

	/** @param list<array{userid: string, propertypath: string, propertyvalue: string}> $rows */
	private function service(array $zones, array $rows, int $queries = 1): TimeService {
		$config = $this->createMock(IUserConfig::class);
		$config->expects($this->exactly($queries))->method('getValuesByUsers')->with('core', 'timezone')->willReturn($zones);
		$result = $this->createStub(IResult::class);
		$result->method('fetch')->willReturnOnConsecutiveCalls(...[...$rows, false]);
		$qb = $this->createStub(IQueryBuilder::class);
		$qb->method('select')->willReturnSelf();
		$qb->method('from')->willReturnSelf();
		$qb->method('where')->willReturnSelf();
		$qb->method('andWhere')->willReturnSelf();
		$qb->method('expr')->willReturn($this->createStub(IExpressionBuilder::class));
		$qb->method('executeQuery')->willReturn($result);
		$db = $this->createStub(IDBConnection::class);
		$db->method('getQueryBuilder')->willReturn($qb);
		return new TimeService($config, $db);
	}

	public function testPeopleWithoutHoursWorkWeekdaysNineToFive(): void {
		$service = $this->service(['alice' => 'Europe/Berlin', 'bao' => 'Mars/Olympus'], [
			['userid' => 'chi', 'propertypath' => 'calendars/chi/inbox', 'propertyvalue' => self::AVAILABILITY],
			// Only the schedule inbox counts.
			['userid' => 'alice', 'propertypath' => 'calendars/alice/personal', 'propertyvalue' => self::AVAILABILITY],
		]);
		$times = $service->forUsers(['alice', 'bao', 'chi', 'alice']);
		$this->assertSame(['alice', 'bao', 'chi'], array_keys($times));
		$this->assertSame('Europe/Berlin', $times['alice']['timeZone']);
		$this->assertTrue($times['alice']['hours']['default']);
		$this->assertSame('Europe/Berlin', $times['alice']['hours']['timeZone']);
		$this->assertSame([[540, 1020]], $times['alice']['hours']['days'][3]);
		$this->assertSame([], $times['alice']['hours']['days'][6]);
		// An unknown zone counts as not set.
		$this->assertNull($times['bao']['timeZone']);
		$this->assertNull($times['bao']['hours']['timeZone']);
		$this->assertNull($times['chi']['timeZone']);
		$this->assertSame('Asia/Ho_Chi_Minh', $times['chi']['hours']['timeZone']);
		$this->assertFalse($times['chi']['hours']['default']);
		// Answers are kept for the rest of the request.
		$this->assertSame('Europe/Berlin', $service->timeZone('alice'));
		$this->assertSame($times['chi']['hours'], $service->hours('chi'));
	}

	public function testSharedMinutesCompareAcrossZonesAndDaylightSavingTime(): void {
		$berlin = ['timeZone' => 'Europe/Berlin', 'days' => array_fill(1, 7, []), 'default' => false];
		$berlin['days'][1] = [[540, 1020]];
		$newYork = ['timeZone' => 'America/New_York', 'days' => array_fill(1, 7, []), 'default' => false];
		$newYork['days'][1] = [[540, 1020]];
		// Monday 2027-03-15: Berlin is on winter time (UTC+1), New York already on summer time (UTC−4).
		$sunday = (new \DateTimeImmutable('2027-03-14 12:00', new \DateTimeZone('UTC')))->getTimestamp() * 1000;
		// Berlin 09:00–17:00 is 08:00–16:00 UTC; New York 09:00–17:00 is 13:00–21:00 UTC: 3 hours together.
		$this->assertSame(180, TimeService::sharedMinutes($berlin, $newYork, $sunday));
		// A week later Berlin moved too (UTC+2): only 2 hours.
		$this->assertSame(120, TimeService::sharedMinutes($berlin, $newYork, $sunday + 14 * 86_400_000));
		$this->assertSame(480, TimeService::sharedMinutes($berlin, $berlin, $sunday));
		$unknown = ['timeZone' => null, 'days' => $berlin['days'], 'default' => true];
		$this->assertSame(0, TimeService::sharedMinutes($berlin, $unknown, $sunday));
	}
}
