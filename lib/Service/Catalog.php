<?php

declare(strict_types=1);

/**
 * SPDX-FileCopyrightText: 2026 Hoang Pham
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

namespace OCA\VirtualOffice\Service;

use OCA\VirtualOffice\Exception\ApiException;

/**
 * Reads catalog/catalog.json, the single source for map, characters and
 * decor shared with the frontend.
 */
class Catalog {
	private ?array $data = null;

	public function __construct(
		private string $path = __DIR__ . '/../../catalog/catalog.json',
	) {
	}

	public function data(): array {
		if ($this->data === null) {
			$this->data = json_decode((string)file_get_contents($this->path), true, 32, JSON_THROW_ON_ERROR);
		}
		return $this->data;
	}

	public function hash(): string {
		return (string)hash_file('sha256', $this->path);
	}

	public function defaultLayoutId(): string {
		return $this->data()['defaultLayout'];
	}

	/** @return array{width: int, height: int, collision: list<string>, spawn: list<array{0: int, 1: int}>, zones: list<array{id: string, rect: array{0: int, 1: int, 2: int, 3: int}}>, zoneAnchors: array<string, array{0: int, 1: int}>, props: list<array{id: string, cell: array{0: int, 1: int}, radius: float, durationMs: int}>, desks?: list<array{id: string, cell: array{0: int, 1: int}}>} */
	public function layout(string $id): array {
		$layout = $this->data()['layouts'][$id] ?? null;
		if (!is_array($layout)) {
			throw ApiException::invalid('Unknown layout');
		}
		return $layout;
	}

	public function zoneAt(array $layout, int $x, int $y): ?string {
		foreach ($layout['zones'] as $zone) {
			[$left, $top, $width, $height] = $zone['rect'];
			if ($x >= $left && $x < $left + $width && $y >= $top && $y < $top + $height) {
				return $zone['id'];
			}
		}
		return null;
	}

	/** @return list<string> */
	public function deskIds(array $layout): array {
		return array_column($layout['desks'] ?? [], 'id');
	}

	public function msPerEdge(): int {
		return (int)$this->data()['movement']['msPerEdge'];
	}

	public function maxPathEdges(): int {
		return (int)$this->data()['movement']['maxPathEdges'];
	}

	public function maxCapacity(): int {
		return (int)$this->data()['limits']['roomCapacity'];
	}

	public function isWalkable(array $layout, mixed $x, mixed $y): bool {
		return is_int($x) && is_int($y)
			&& $y >= 0 && $y < $layout['height'] && $x >= 0 && $x < $layout['width']
			&& $layout['collision'][$y][$x] === '.';
	}

	/** @return list<string> */
	public function emoteIds(): array {
		return array_column($this->data()['emotes'], 'id');
	}

	public function emoteDuration(string $id): int {
		foreach ($this->data()['emotes'] as $emote) {
			if ($emote['id'] === $id) {
				return (int)$emote['durationMs'];
			}
		}
		throw ApiException::invalid('Unknown emote');
	}

	/** @return list<string> */
	public function modes(): array {
		return $this->data()['modes'];
	}

	/** @return array{creature: string, palette: string, accessory: string} */
	public function defaultAppearance(): array {
		return $this->data()['defaults']['appearance'];
	}

	/**
	 * @return array{creature: string, palette: string, accessory: string}
	 * @throws ApiException
	 */
	public function validateAppearance(mixed $appearance): array {
		if (!is_array($appearance) || array_diff(array_keys($appearance), ['creature', 'palette', 'accessory']) !== []) {
			throw ApiException::invalid('Invalid appearance');
		}
		$data = $this->data();
		$creature = $appearance['creature'] ?? null;
		$palette = $appearance['palette'] ?? null;
		$accessory = $appearance['accessory'] ?? null;
		if (!in_array($creature, $data['creatures'], true)
			|| !in_array($palette, array_column($data['palettes'], 'id'), true)
			|| !in_array($accessory, $data['accessories'], true)) {
			throw ApiException::invalid('Invalid appearance');
		}
		return ['creature' => $creature, 'palette' => $palette, 'accessory' => $accessory];
	}

	/**
	 * @return array<string, string> complete decor with defaults filled in
	 * @throws ApiException
	 */
	public function validateDecor(mixed $decor): array {
		if (!is_array($decor)) {
			throw ApiException::invalid('Invalid decor');
		}
		$slots = $this->data()['decor'];
		$result = [];
		foreach ($decor as $slot => $value) {
			if (!isset($slots[$slot]) || !in_array($value, $slots[$slot]['options'], true)) {
				throw ApiException::invalid('Invalid decor');
			}
		}
		foreach ($slots as $slot => $definition) {
			$result[$slot] = $decor[$slot] ?? $definition['default'];
		}
		return $result;
	}

	/** @return array{id: string, cell: array{0: int, 1: int}, radius: float, durationMs: int}|null */
	public function prop(array $layout, string $id): ?array {
		foreach ($layout['props'] as $prop) {
			if ($prop['id'] === $id) {
				return $prop;
			}
		}
		return null;
	}
}
