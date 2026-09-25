<?php

declare(strict_types=1);

/**
 * SPDX-FileCopyrightText: 2026 Hoang Pham
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

namespace OCA\VirtualOffice\Service;

use OCA\VirtualOffice\AppInfo\Application;
use OCA\VirtualOffice\Exception\ApiException;
use OCP\AppFramework\Http;
use OCP\Config\IUserConfig;
use OCP\Lock\ILockingProvider;
use OCP\Lock\LockedException;

/** Appearance, UI choices and the "Today" note, stored as ordinary per-user app config. */
class PreferenceService {
	public const NOTE_MAX_LENGTH = 80;
	private const NOTE_MAX_MS = 86_400_000;

	public function __construct(
		private IUserConfig $userConfig,
		private Catalog $catalog,
		private ILockingProvider $locks,
	) {
	}

	/** @return array{revision: int, preferences: ?array{appearance: array{creature: string, palette: string, accessory: string}, ui: array{view: string, reducedEffects: bool, announcements: bool}}} */
	public function get(string $uid): array {
		$revision = $this->userConfig->getValueInt($uid, Application::APP_ID, 'revision', 0);
		$stored = json_decode($this->userConfig->getValueString($uid, Application::APP_ID, 'preferences', ''), true);
		if ($revision === 0 || !is_array($stored)) {
			return ['revision' => 0, 'preferences' => null];
		}
		try {
			return ['revision' => $revision, 'preferences' => $this->validate($stored)];
		} catch (ApiException) {
			return ['revision' => $revision, 'preferences' => null];
		}
	}

	/** @return array{creature: string, palette: string, accessory: string} */
	public function appearance(string $uid): array {
		return $this->get($uid)['preferences']['appearance'] ?? $this->catalog->defaultAppearance();
	}

	/**
	 * Saves when the stored revision still matches. A lock makes the check and
	 * the write one step, so two windows saving at once cannot both win.
	 *
	 * @throws ApiException
	 */
	public function set(string $uid, int $expectedRevision, mixed $preferences): array {
		$clean = $this->validate($preferences);
		$lock = 'virtualoffice/preferences/' . hash('sha256', $uid);
		try {
			$this->locks->acquireLock($lock, ILockingProvider::LOCK_EXCLUSIVE);
		} catch (LockedException) {
			throw new ApiException('CONFLICT', Http::STATUS_CONFLICT, 'Preferences are being saved elsewhere');
		}
		try {
			// Values are cached per request; read what another request may have just saved.
			$this->userConfig->clearCache($uid);
			$current = $this->userConfig->getValueInt($uid, Application::APP_ID, 'revision', 0);
			if ($current !== $expectedRevision) {
				throw new ApiException('REVISION_MISMATCH', Http::STATUS_PRECONDITION_FAILED, 'Preferences changed elsewhere', $this->get($uid));
			}
			$this->userConfig->setValueString($uid, Application::APP_ID, 'preferences', json_encode($clean, JSON_THROW_ON_ERROR));
			$this->userConfig->setValueInt($uid, Application::APP_ID, 'revision', $current + 1);
			return ['revision' => $current + 1, 'preferences' => $clean];
		} finally {
			$this->locks->releaseLock($lock, ILockingProvider::LOCK_EXCLUSIVE);
		}
	}

	/**
	 * The "Today" note while it has not expired.
	 *
	 * @return array{text: string, expiresAt: int}|null
	 */
	public function today(string $uid, int $now): ?array {
		$note = json_decode($this->userConfig->getValueString($uid, Application::APP_ID, 'today', ''), true);
		if (!is_array($note) || !is_string($note['text'] ?? null) || !is_int($note['expiresAt'] ?? null) || $note['expiresAt'] <= $now) {
			return null;
		}
		return ['text' => $note['text'], 'expiresAt' => $note['expiresAt']];
	}

	/**
	 * Sets or, with empty text, clears the note. It expires at the given time,
	 * usually the end of the person's day, and after 24 hours at the latest.
	 *
	 * @return array{text: string, expiresAt: int}|null
	 * @throws ApiException
	 */
	public function setToday(string $uid, mixed $text, mixed $expiresAt, int $now): ?array {
		if (!is_string($text) || !is_int($expiresAt)) {
			throw ApiException::invalid('Invalid note');
		}
		$text = trim((string)preg_replace('/\s+/u', ' ', $text));
		if ($text === '') {
			$this->userConfig->deleteUserConfig($uid, Application::APP_ID, 'today');
			return null;
		}
		if (mb_strlen($text) > self::NOTE_MAX_LENGTH) {
			throw ApiException::invalid('The note is too long');
		}
		$note = ['text' => $text, 'expiresAt' => max($now + 60_000, min($expiresAt, $now + self::NOTE_MAX_MS))];
		$this->userConfig->setValueString($uid, Application::APP_ID, 'today', json_encode($note, JSON_THROW_ON_ERROR));
		return $note;
	}

	public function reset(string $uid): void {
		$this->userConfig->deleteUserConfig($uid, Application::APP_ID, 'preferences');
		$this->userConfig->deleteUserConfig($uid, Application::APP_ID, 'revision');
	}

	/** @throws ApiException */
	private function validate(mixed $preferences): array {
		if (!is_array($preferences) || array_diff(array_keys($preferences), ['appearance', 'ui']) !== []) {
			throw ApiException::invalid('Invalid preferences');
		}
		$ui = $preferences['ui'] ?? [];
		if (!is_array($ui) || array_diff(array_keys($ui), ['view', 'reducedEffects', 'announcements']) !== []) {
			throw ApiException::invalid('Invalid preferences');
		}
		$view = $ui['view'] ?? 'scene';
		if (!in_array($view, ['scene', 'list'], true)
			|| !is_bool($ui['reducedEffects'] ?? false)
			|| !is_bool($ui['announcements'] ?? true)) {
			throw ApiException::invalid('Invalid preferences');
		}
		return [
			'appearance' => $this->catalog->validateAppearance($preferences['appearance'] ?? null),
			'ui' => [
				'view' => $view,
				'reducedEffects' => $ui['reducedEffects'] ?? false,
				'announcements' => $ui['announcements'] ?? true,
			],
		];
	}
}
