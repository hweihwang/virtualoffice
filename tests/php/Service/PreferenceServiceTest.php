<?php

declare(strict_types=1);

/**
 * SPDX-FileCopyrightText: 2026 Hoang Pham
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

namespace OCA\VirtualOffice\Tests\Service;

use OCA\VirtualOffice\Exception\ApiException;
use OCA\VirtualOffice\Service\Catalog;
use OCA\VirtualOffice\Service\PreferenceService;
use OCP\Config\IUserConfig;
use OCP\Lock\ILockingProvider;
use OCP\Lock\LockedException;
use PHPUnit\Framework\Attributes\AllowMockObjectsWithoutExpectations;
use PHPUnit\Framework\TestCase;

#[AllowMockObjectsWithoutExpectations]
class PreferenceServiceTest extends TestCase {
	private array $store = [];
	private PreferenceService $service;
	private ILockingProvider&\PHPUnit\Framework\MockObject\MockObject $locks;

	protected function setUp(): void {
		$config = $this->createStub(IUserConfig::class);
		$config->method('getValueInt')->willReturnCallback(fn ($uid, $app, $key, $default) => $this->store[$uid][$key] ?? $default);
		$config->method('getValueString')->willReturnCallback(fn ($uid, $app, $key, $default) => $this->store[$uid][$key] ?? $default);
		$config->method('setValueInt')->willReturnCallback(function ($uid, $app, $key, $value) {
			$this->store[$uid][$key] = $value;
			return true;
		});
		$config->method('setValueString')->willReturnCallback(function ($uid, $app, $key, $value) {
			$this->store[$uid][$key] = $value;
			return true;
		});
		$config->method('getValuesByUsers')->willReturnCallback(fn ($app, $key) => array_map(fn (array $values) => $values[$key], array_filter($this->store, fn (array $values) => isset($values[$key]))));
		$config->method('deleteUserConfig')->willReturnCallback(function ($uid, $app, $key) {
			unset($this->store[$uid][$key]);
		});
		$this->locks = $this->createMock(ILockingProvider::class);
		$this->service = new PreferenceService($config, new Catalog(), $this->locks);
	}

	private function prefs(string $creature = 'cat'): array {
		return ['appearance' => ['creature' => $creature, 'palette' => 'sky', 'accessory' => 'glasses'], 'ui' => ['view' => 'list', 'reducedEffects' => true, 'announcements' => false]];
	}

	public function testDefaultsUntilSaved(): void {
		$this->assertSame(['revision' => 0, 'preferences' => null], $this->service->get('alice'));
		$this->assertSame(['creature' => 'rabbit', 'palette' => 'sage', 'accessory' => 'none'], $this->service->appearance('alice'));
	}

	public function testSaveUsesRevisions(): void {
		$saved = $this->service->set('alice', 0, $this->prefs());
		$this->assertSame(1, $saved['revision']);
		$this->assertSame('cat', $this->service->appearance('alice')['creature']);
		try {
			$this->service->set('alice', 0, $this->prefs('bear'));
			$this->fail('Stale revision accepted');
		} catch (ApiException $e) {
			$this->assertSame(412, $e->getHttpStatus());
		}
		$this->assertSame(2, $this->service->set('alice', 1, $this->prefs('bear'))['revision']);
		$this->service->reset('alice');
		$this->assertSame(['revision' => 0, 'preferences' => null], $this->service->get('alice'));
	}

	public function testSoundSettingsHaveDefaults(): void {
		$saved = $this->service->set('alice', 0, ['appearance' => $this->prefs()['appearance'], 'ui' => ['view' => 'scene']]);
		$this->assertSame(['view' => 'scene', 'reducedEffects' => false, 'announcements' => true, 'musicVolume' => 50, 'voiceMode' => 'push', 'voiceVolume' => 100], $saved['preferences']['ui']);
		$saved = $this->service->set('alice', 1, ['appearance' => $this->prefs()['appearance'], 'ui' => ['musicVolume' => 0, 'voiceMode' => 'open', 'voiceVolume' => 30]]);
		$this->assertSame([0, 'open', 30], [$saved['preferences']['ui']['musicVolume'], $saved['preferences']['ui']['voiceMode'], $saved['preferences']['ui']['voiceVolume']]);
	}

	public function testRejectsUnknownFields(): void {
		foreach ([
			['appearance' => $this->prefs()['appearance'], 'ui' => ['view' => 'grid']],
			['appearance' => $this->prefs()['appearance'], 'ui' => ['reducedEffects' => 'yes']],
			['appearance' => $this->prefs()['appearance'], 'ui' => ['musicVolume' => 101]],
			['appearance' => $this->prefs()['appearance'], 'ui' => ['musicVolume' => '50']],
			['appearance' => $this->prefs()['appearance'], 'ui' => ['voiceMode' => 'always']],
			['appearance' => $this->prefs()['appearance'], 'ui' => ['voiceVolume' => -1]],
			['appearance' => $this->prefs()['appearance'], 'avatarUrl' => 'https://evil.example/x.svg'],
			'nope',
		] as $bad) {
			try {
				$this->service->set('alice', 0, $bad);
				$this->fail('Accepted ' . json_encode($bad));
			} catch (ApiException $e) {
				$this->assertSame('INVALID_INPUT', $e->getApiCode());
			}
		}
	}

	public function testTheLockIsReleasedEvenWhenTheRevisionIsStale(): void {
		$this->locks->expects($this->exactly(2))->method('acquireLock');
		$this->locks->expects($this->exactly(2))->method('releaseLock');
		$this->service->set('alice', 0, $this->prefs());
		$this->expectException(ApiException::class);
		$this->service->set('alice', 0, $this->prefs('bear'));
	}

	public function testConcurrentSaveIsAConflict(): void {
		$this->locks->method('acquireLock')->willThrowException(new LockedException('virtualoffice/preferences'));
		try {
			$this->service->set('alice', 0, $this->prefs());
			$this->fail('Saved while locked');
		} catch (ApiException $e) {
			$this->assertSame('CONFLICT', $e->getApiCode());
		}
		$this->assertSame(['revision' => 0, 'preferences' => null], $this->service->get('alice'));
	}

	public function testTodayNoteIsCleanedCappedAndExpires(): void {
		$now = 1_000_000;
		$note = $this->service->setToday('alice', "  Finish   the\nQ3 export ", $now + 999_999_999, $now);
		$this->assertSame(['text' => 'Finish the Q3 export', 'expiresAt' => $now + 86_400_000], $note);
		$this->assertSame($note, $this->service->today('alice', $now + 1000));
		$this->assertNull($this->service->today('alice', $now + 86_400_000));

		$this->assertSame($now + 60_000, $this->service->setToday('alice', 'Soon', $now - 5, $now)['expiresAt']);
		$this->assertNull($this->service->setToday('alice', '   ', $now + 1000, $now));
		$this->assertNull($this->service->today('alice', $now));
	}

	public function testExpiredTodayNotesAreDeleted(): void {
		$this->service->setToday('alice', 'Planning', 2_000_000, 1_000_000);
		$this->service->setToday('bao', 'Reviews', 9_000_000, 1_000_000);
		$this->service->expireToday(3_000_000);
		$this->assertArrayNotHasKey('today', $this->store['alice']);
		$this->assertSame('Reviews', $this->service->today('bao', 3_000_000)['text']);
	}

	public function testTodayNoteRejectsBadInput(): void {
		foreach ([[str_repeat('ư', PreferenceService::NOTE_MAX_LENGTH + 1), 5], [['text'], 5], ['ok', '5']] as [$text, $expiresAt]) {
			try {
				$this->service->setToday('alice', $text, $expiresAt, 0);
				$this->fail('Accepted ' . json_encode($text));
			} catch (ApiException $e) {
				$this->assertSame('INVALID_INPUT', $e->getApiCode());
			}
		}
		$this->assertNotNull($this->service->setToday('alice', str_repeat('ư', PreferenceService::NOTE_MAX_LENGTH), 5, 0));
	}
}
