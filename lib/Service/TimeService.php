<?php

declare(strict_types=1);

/**
 * SPDX-FileCopyrightText: 2026 Hoang Pham
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

namespace OCA\VirtualOffice\Service;

use OCP\Config\IUserConfig;
use OCP\Config\ValueType;
use OCP\DB\QueryBuilder\IQueryBuilder;
use OCP\IDBConnection;
use Sabre\VObject\Component\Available;
use Sabre\VObject\Property\ICalendar\Recur;
use Sabre\VObject\Reader;

/**
 * Local time zone and working hours of people, so members of an office see
 * when colleagues in other places are around.
 *
 * The time zone is the one in Personal settings › Locale (core/timezone), read
 * directly: IDateTimeZone::getTimeZone() for another user falls back to the
 * caller's session. Working hours come from Personal settings › Availability,
 * the CalDAV property dav reads for its status automation; Nextcloud has no
 * public API for them.
 *
 * @psalm-type Hours = array{timeZone: ?string, days: array<int, list<array{0: int, 1: int}>>, default: bool}
 */
class TimeService {
	/** Monday to Friday, 09:00 to 17:00, for people who did not set their hours. */
	public const DEFAULT_START = 540;
	public const DEFAULT_END = 1020;
	private const AVAILABILITY = '{urn:ietf:params:xml:ns:caldav}calendar-availability';
	private const WEEKDAYS = ['MO' => 1, 'TU' => 2, 'WE' => 3, 'TH' => 4, 'FR' => 5, 'SA' => 6, 'SU' => 7];

	/** @var array<string, ?string> */
	private array $zones = [];
	/** @var array<string, Hours> */
	private array $hours = [];

	public function __construct(
		private IUserConfig $userConfig,
		private IDBConnection $db,
	) {
	}

	/**
	 * @param list<string> $uids
	 * @return array<string, array{timeZone: ?string, hours: Hours}>
	 */
	public function forUsers(array $uids): array {
		$this->load($uids);
		$result = [];
		foreach (array_unique($uids) as $uid) {
			$result[$uid] = ['timeZone' => $this->zones[$uid], 'hours' => $this->hours[$uid]];
		}
		return $result;
	}

	/** The person's time zone, or null when they never set one. */
	public function timeZone(string $uid): ?string {
		$this->load([$uid]);
		return $this->zones[$uid];
	}

	/** @return Hours */
	public function hours(string $uid): array {
		$this->load([$uid]);
		return $this->hours[$uid];
	}

	/** @param list<string> $uids */
	private function load(array $uids): void {
		$missing = array_values(array_filter(array_unique($uids), fn (string $uid) => !array_key_exists($uid, $this->zones)));
		if ($missing === []) {
			return;
		}
		$stored = $this->userConfig->getValuesByUsers('core', 'timezone', ValueType::STRING, $missing);
		$availability = $this->availability($missing);
		foreach ($missing as $uid) {
			$zone = self::validZone($stored[$uid] ?? null);
			$this->zones[$uid] = $zone;
			$this->hours[$uid] = (isset($availability[$uid]) ? self::parseAvailability($availability[$uid]) : null)
				?? ['timeZone' => $zone, 'days' => self::defaultDays(), 'default' => true];
		}
	}

	/**
	 * @param list<string> $uids
	 * @return array<string, string> uid => VCALENDAR with the VAVAILABILITY
	 */
	private function availability(array $uids): array {
		$result = [];
		foreach (array_chunk($uids, 500) as $chunk) {
			$qb = $this->db->getQueryBuilder();
			$qb->select('userid', 'propertypath', 'propertyvalue')
				->from('properties')
				->where($qb->expr()->eq('propertyname', $qb->createNamedParameter(self::AVAILABILITY)))
				->andWhere($qb->expr()->in('userid', $qb->createNamedParameter($chunk, IQueryBuilder::PARAM_STR_ARRAY)));
			$rows = $qb->executeQuery();
			while ($row = $rows->fetch()) {
				if ($row['propertypath'] === 'calendars/' . $row['userid'] . '/inbox' && is_string($row['propertyvalue'])) {
					$result[(string)$row['userid']] = $row['propertyvalue'];
				}
			}
			$rows->closeCursor();
		}
		return $result;
	}

	/**
	 * Weekly working hours from a VAVAILABILITY as Nextcloud's Availability
	 * settings save it: one AVAILABLE per time range, with a weekly RRULE
	 * listing its days. Ranges are minutes after local midnight; one that
	 * crosses midnight ends after 1440.
	 *
	 * @return Hours|null null when there is nothing usable
	 */
	public static function parseAvailability(string $ics): ?array {
		try {
			$calendar = Reader::read($ics, Reader::OPTION_FORGIVING);
		} catch (\Throwable) {
			return null;
		}
		$days = array_fill(1, 7, []);
		$zone = null;
		$found = false;
		foreach ($calendar->getComponents() as $availability) {
			if ($availability->name !== 'VAVAILABILITY') {
				continue;
			}
			foreach ($availability->getComponents() as $available) {
				$rule = $available instanceof Available ? ($available->select('RRULE')[0] ?? null) : null;
				if (!$available instanceof Available || !$rule instanceof Recur) {
					continue;
				}
				try {
					[$start, $end] = $available->getEffectiveStartEnd();
				} catch (\Throwable) {
					continue;
				}
				if (!$start instanceof \DateTimeInterface || !$end instanceof \DateTimeInterface || $end <= $start) {
					continue;
				}
				$byDay = $rule->getParts()['BYDAY'] ?? [];
				$from = (int)$start->format('G') * 60 + (int)$start->format('i');
				$minutes = intdiv($end->getTimestamp() - $start->getTimestamp(), 60);
				foreach ((array)$byDay as $day) {
					$weekday = self::WEEKDAYS[strtoupper(substr((string)$day, -2))] ?? null;
					if ($weekday !== null) {
						$days[$weekday][] = [$from, min($from + $minutes, $from + 1440)];
						$found = true;
					}
				}
				$zone ??= self::validZone($start->getTimezone()->getName());
			}
		}
		if (!$found) {
			return null;
		}
		foreach ($days as &$ranges) {
			usort($ranges, static fn (array $a, array $b) => $a[0] <=> $b[0]);
		}
		return ['timeZone' => $zone, 'days' => $days, 'default' => false];
	}

	/**
	 * Minutes in the coming week, from $fromMs, when both people work.
	 *
	 * @param Hours $a
	 * @param Hours $b
	 */
	public static function sharedMinutes(array $a, array $b, int $fromMs, int $days = 7): int {
		$from = intdiv($fromMs, 1000);
		$until = $from + $days * 86_400;
		$left = self::intervals($a, $from, $until);
		$right = self::intervals($b, $from, $until);
		$shared = 0;
		foreach ($left as [$s1, $e1]) {
			foreach ($right as [$s2, $e2]) {
				$shared += max(0, min($e1, $e2) - max($s1, $s2));
			}
		}
		return intdiv($shared, 60);
	}

	/**
	 * Working time between two Unix times as absolute intervals, so people in
	 * different zones can be compared.
	 *
	 * @param Hours $hours
	 * @return list<array{0: int, 1: int}>
	 */
	private static function intervals(array $hours, int $from, int $until): array {
		if ($hours['timeZone'] === null) {
			return [];
		}
		$zone = new \DateTimeZone($hours['timeZone']);
		$day = (new \DateTimeImmutable('@' . $from))->setTimezone($zone)->setTime(0, 0)->modify('-1 day');
		$result = [];
		while ($day->getTimestamp() < $until) {
			foreach ($hours['days'][(int)$day->format('N')] ?? [] as [$start, $end]) {
				$s = self::at($day, $start)->getTimestamp();
				$e = self::at($day, $end)->getTimestamp();
				if ($e > $from && $s < $until) {
					$result[] = [max($s, $from), min($e, $until)];
				}
			}
			$day = $day->modify('+1 day');
		}
		return $result;
	}

	/** Local wall time, minutes after midnight of $day; past 1440 is the next day. */
	private static function at(\DateTimeImmutable $day, int $minutes): \DateTimeImmutable {
		return $day->modify('+' . intdiv($minutes, 1440) . ' day')->setTime(intdiv($minutes % 1440, 60), $minutes % 60);
	}

	/** @return array<int, list<array{0: int, 1: int}>> */
	private static function defaultDays(): array {
		$days = array_fill(1, 7, []);
		for ($day = 1; $day <= 5; $day++) {
			$days[$day] = [[self::DEFAULT_START, self::DEFAULT_END]];
		}
		return $days;
	}

	private static function validZone(mixed $name): ?string {
		if (!is_string($name) || $name === '') {
			return null;
		}
		try {
			return (new \DateTimeZone($name))->getName();
		} catch (\Throwable) {
			return null;
		}
	}
}
