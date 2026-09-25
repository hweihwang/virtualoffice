<?php

declare(strict_types=1);

/**
 * SPDX-FileCopyrightText: 2026 Hoang Pham
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

namespace OCA\VirtualOffice\Tests\Service;

use OCA\VirtualOffice\Service\Catalog;
use OCA\VirtualOffice\Service\Movement;
use PHPUnit\Framework\TestCase;

class MovementTest extends TestCase {
	private Catalog $catalog;
	private Movement $movement;
	private array $layout;

	protected function setUp(): void {
		$this->catalog = new Catalog();
		$this->movement = new Movement($this->catalog);
		$this->layout = $this->catalog->layout('starter-office-v1');
	}

	private function walk(array $from, array $path, int $at = 0): array {
		return $this->movement->rerouteVia($this->movement->stationary($from, $at), $at, $path);
	}

	public function testTimesEachStep(): void {
		$t = $this->walk([5, 5], [[5, 5], [6, 5], [7, 5]], 1000);
		$this->assertSame([[5, 5], [6, 5], [7, 5]], $t['points']);
		$this->assertSame([1000, 1250, 1500], $t['arriveAt']);
		$this->assertSame(1, $t['id']);
	}

	public function testPositionIsInterpolatedAndClamped(): void {
		$t = $this->walk([5, 5], [[5, 5], [6, 5]], 1000);
		$this->assertSame([5, 5], $this->movement->positionAt($t, 0));
		$this->assertEqualsWithDelta([5.5, 5], $this->movement->positionAt($t, 1125), 1e-9);
		$this->assertSame([6, 5], $this->movement->positionAt($t, 5000));
	}

	public function testRerouteKeepsStepDeadlines(): void {
		$first = $this->walk([5, 5], [[5, 5], [6, 5], [7, 5], [8, 5]]);
		$second = $this->movement->rerouteVia($first, 375, [[7, 5], [7, 6]]);
		$this->assertNotNull($second);
		$this->assertEqualsWithDelta([6.5, 5], $second['points'][0], 1e-9);
		$this->assertSame([375, 500, 750], $second['arriveAt']);
	}

	public function testRerouteMayJoinALaterPlannedCell(): void {
		$first = $this->walk([5, 5], [[5, 5], [6, 5], [7, 5], [8, 5]]);
		$joined = $this->movement->rerouteVia($first, 100, [[7, 5], [7, 6]]);
		$this->assertSame([100, 250, 500, 750], $joined['arriveAt']);
	}

	public function testRerouteRejectsPassedOrUnrelatedStart(): void {
		$first = $this->walk([5, 5], [[5, 5], [6, 5], [7, 5]]);
		$this->assertNull($this->movement->rerouteVia($first, 260, [[6, 5], [6, 6]]));
		$this->assertNull($this->movement->rerouteVia($first, 10, [[9, 9]]));
		$this->assertNull($this->movement->rerouteVia($this->movement->stationary([5, 5], 0), 10, [[6, 5]]));
	}

	public function testRerouteSpamNeverSpeedsUp(): void {
		$current = $this->movement->stationary([5, 13], 0);
		$t = 0;
		for ($i = 0; $i < 100; $i++) {
			$t += 37;
			$resting = null;
			foreach ($current['arriveAt'] as $k => $at) {
				if ($at > $t) {
					$resting = $current['points'][$k];
					break;
				}
			}
			$resting ??= end($current['points']);
			$dx = $i % 2 === 0 ? 1 : -1;
			$next = [(int)$resting[0] + $dx, (int)$resting[1]];
			$current = $this->movement->rerouteVia($current, $t, [[(int)$resting[0], (int)$resting[1]], $next]) ?? $current;
			$count = count($current['points']);
			for ($k = 1; $k < $count; $k++) {
				$distance = hypot($current['points'][$k][0] - $current['points'][$k - 1][0], $current['points'][$k][1] - $current['points'][$k - 1][1]);
				$this->assertGreaterThanOrEqual($distance * 250 - 1e-6, $current['arriveAt'][$k] - $current['arriveAt'][$k - 1]);
			}
		}
	}

	public function testStopEndsTheCurrentStep(): void {
		$moving = $this->walk([5, 5], [[5, 5], [6, 5], [7, 5]]);
		$stopped = $this->movement->stop($moving, 100);
		$this->assertSame(250, end($stopped['arriveAt']));
		$this->assertSame([6, 5], end($stopped['points']));
		$this->assertSame([6, 5], $this->movement->restingCell($moving, 100));
		$idle = $this->movement->stationary([5, 5], 0);
		$this->assertSame($idle, $this->movement->stop($idle, 100));
	}

	public static function invalidPaths(): array {
		return [
			'empty' => [[]],
			'not a list' => [['a' => [5, 5]]],
			'gap' => [[[5, 5], [7, 5]]],
			'diagonal' => [[[5, 5], [6, 6]]],
			'blocked' => [[[15, 10], [16, 10]]],
			'outside' => [[[40, 3]]],
			'float' => [[[5.5, 5]]],
			'string' => [[['5', '5']]],
			'three numbers' => [[[5, 5, 5]]],
			'too long' => [array_map(static fn ($i) => [5, 5 + ($i % 2)], range(0, 70))],
		];
	}

	#[\PHPUnit\Framework\Attributes\DataProvider('invalidPaths')]
	public function testRejectsInvalidPaths(array $path): void {
		$this->assertFalse($this->movement->isValidPath($this->layout, $path));
	}

	public function testAcceptsValidPaths(): void {
		$this->assertTrue($this->movement->isValidPath($this->layout, [[5, 5]]));
		$this->assertTrue($this->movement->isValidPath($this->layout, [[5, 5], [6, 5], [6, 6]]));
	}
}
