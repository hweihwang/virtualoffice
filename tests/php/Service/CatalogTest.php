<?php

declare(strict_types=1);

/**
 * SPDX-FileCopyrightText: 2026 Hoang Pham
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

namespace OCA\VirtualOffice\Tests\Service;

use OCA\VirtualOffice\Exception\ApiException;
use OCA\VirtualOffice\Service\Catalog;
use PHPUnit\Framework\TestCase;

class CatalogTest extends TestCase {
	private Catalog $catalog;

	protected function setUp(): void {
		$this->catalog = new Catalog();
	}

	public function testHashIsFileHash(): void {
		$this->assertSame(hash_file('sha256', __DIR__ . '/../../../catalog/catalog.json'), $this->catalog->hash());
	}

	public function testAppearanceMustComeFromCatalog(): void {
		$this->assertSame(
			['creature' => 'cat', 'palette' => 'rose', 'accessory' => 'scarf'],
			$this->catalog->validateAppearance(['creature' => 'cat', 'palette' => 'rose', 'accessory' => 'scarf']),
		);
		foreach ([
			['creature' => 'dragon', 'palette' => 'rose', 'accessory' => 'none'],
			['creature' => 'cat', 'palette' => '#ff0000', 'accessory' => 'none'],
			['creature' => 'cat', 'palette' => 'rose', 'accessory' => 'none', 'url' => 'x'],
			'cat',
		] as $bad) {
			try {
				$this->catalog->validateAppearance($bad);
				$this->fail('Accepted invalid appearance');
			} catch (ApiException $e) {
				$this->assertSame('INVALID_INPUT', $e->getApiCode());
			}
		}
	}

	public function testDecorFillsDefaultsAndRejectsUnknownValues(): void {
		$decor = $this->catalog->validateDecor(['rug' => 'ocean']);
		$this->assertSame(['floor' => 'oak', 'rug' => 'ocean', 'wallArt' => 'mountains', 'lights' => 'warm'], $decor);
		$this->expectException(ApiException::class);
		$this->catalog->validateDecor(['rug' => 'lava']);
	}

	public function testUnknownDecorSlotIsRejected(): void {
		$this->expectException(ApiException::class);
		$this->catalog->validateDecor(['ceiling' => 'oak']);
	}

	public function testEmotesHaveDurations(): void {
		$this->assertSame(['wave', 'heart', 'laugh', 'celebrate'], $this->catalog->emoteIds());
		$this->assertSame(4000, $this->catalog->emoteDuration('wave'));
	}
}
