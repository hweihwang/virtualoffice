<?php

declare(strict_types=1);

/**
 * SPDX-FileCopyrightText: 2026 Hoang Pham
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

namespace OCA\VirtualOffice\Service;

/**
 * Server side of shared/movement.ts. The client plans paths; the server only
 * validates them and fixes their timing. Keep both files in sync.
 *
 * @psalm-type Trajectory = array{id: int, points: list<array{0: int|float, 1: int|float}>, arriveAt: list<int>}
 */
class Movement {
	public function __construct(
		private Catalog $catalog,
	) {
	}

	/** @return Trajectory */
	public function stationary(array $cell, int $at, int $id = 0): array {
		return ['id' => $id, 'points' => [$cell], 'arriveAt' => [$at]];
	}

	/**
	 * @param Trajectory $trajectory
	 * @return array{0: int|float, 1: int|float}
	 */
	public function positionAt(array $trajectory, int $t): array {
		$points = $trajectory['points'];
		$arriveAt = $trajectory['arriveAt'];
		if ($t <= $arriveAt[0] || count($points) === 1) {
			return $points[0];
		}
		$count = count($points);
		for ($i = 1; $i < $count; $i++) {
			if ($t < $arriveAt[$i]) {
				$span = $arriveAt[$i] - $arriveAt[$i - 1];
				$f = $span <= 0 ? 1.0 : (float)($t - $arriveAt[$i - 1]) / (float)$span;
				$ax = (float)$points[$i - 1][0];
				$ay = (float)$points[$i - 1][1];
				$bx = (float)$points[$i][0];
				$by = (float)$points[$i][1];
				return [$ax + ($bx - $ax) * $f, $ay + ($by - $ay) * $f];
			}
		}
		return $points[array_key_last($points)];
	}

	/**
	 * Keep following $current until $path[0], then follow $path. Planned
	 * steps keep their deadlines, so a character never speeds up.
	 *
	 * @param Trajectory $current
	 * @param list<array{0: int, 1: int}> $path
	 * @return Trajectory|null null when $path[0] is not ahead on $current
	 */
	public function rerouteVia(array $current, int $t, array $path): ?array {
		$points = $current['points'];
		$arriveAt = $current['arriveAt'];
		$count = count($points);
		[$sx, $sy] = $path[0];
		$next = $count;
		for ($i = 1; $i < $count; $i++) {
			if ($arriveAt[$i] > $t) {
				$next = $i;
				break;
			}
		}
		$newPoints = [];
		$newArrive = [];
		$at = $t;
		if ($next === $count) {
			[$fx, $fy] = $points[array_key_last($points)];
			if ($fx != $sx || $fy != $sy) {
				return null;
			}
			$newPoints[] = [$sx, $sy];
			$newArrive[] = $t;
		} else {
			$join = -1;
			for ($k = $next; $k < $count; $k++) {
				if ($points[$k][0] == $sx && $points[$k][1] == $sy) {
					$join = $k;
					break;
				}
			}
			if ($join === -1) {
				return null;
			}
			$newPoints[] = $this->positionAt($current, $t);
			$newArrive[] = $t;
			for ($k = $next; $k <= $join; $k++) {
				$newPoints[] = $points[$k];
				$newArrive[] = $arriveAt[$k];
			}
			$at = $arriveAt[$join];
		}
		$step = $this->catalog->msPerEdge();
		$length = count($path);
		for ($i = 1; $i < $length; $i++) {
			$at += $step;
			$newPoints[] = $path[$i];
			$newArrive[] = $at;
		}
		return ['id' => $current['id'] + 1, 'points' => $newPoints, 'arriveAt' => $newArrive];
	}

	/**
	 * @param Trajectory $current
	 * @return Trajectory stopped at the end of the step in progress
	 */
	public function stop(array $current, int $t): array {
		$count = count($current['points']);
		for ($i = 1; $i < $count; $i++) {
			if ($current['arriveAt'][$i] > $t) {
				return $this->rerouteVia($current, $t, [$current['points'][$i]]) ?? $current;
			}
		}
		return $current;
	}

	/** @return array{0: int, 1: int} the cell the character rests on once the current step ends */
	public function restingCell(array $current, int $t): array {
		$stopped = $this->stop($current, $t);
		$last = $stopped['points'][array_key_last($stopped['points'])];
		return [(int)round($last[0]), (int)round($last[1])];
	}

	/** Adjacent, walkable cells within the length limit. */
	public function isValidPath(array $layout, mixed $path): bool {
		if (!is_array($path) || !array_is_list($path) || count($path) < 1 || count($path) > $this->catalog->maxPathEdges() + 1) {
			return false;
		}
		$previous = null;
		foreach ($path as $cell) {
			if (!is_array($cell) || !array_is_list($cell) || count($cell) !== 2
				|| !$this->catalog->isWalkable($layout, $cell[0], $cell[1])) {
				return false;
			}
			if ($previous !== null && abs((int)$previous[0] - (int)$cell[0]) + abs((int)$previous[1] - (int)$cell[1]) !== 1) {
				return false;
			}
			$previous = $cell;
		}
		return true;
	}
}
