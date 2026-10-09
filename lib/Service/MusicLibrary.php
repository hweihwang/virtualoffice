<?php

declare(strict_types=1);

/**
 * SPDX-FileCopyrightText: 2026 Hoang Pham
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

namespace OCA\VirtualOffice\Service;

use OCA\VirtualOffice\Exception\ApiException;
use OCP\Files\File;
use OCP\Files\IRootFolder;
use OCP\Files\Storage\ISharedStorage;
use OCP\Files\Storage\IStorage;
use OCP\IL10N;

/**
 * Audio files people play on the office's music player. The file stays the
 * player's own, read with their permissions on every request.
 */
class MusicLibrary {
	public const MAX_BYTES = 52_428_800;

	public function __construct(
		private IRootFolder $rootFolder,
		private IL10N $l10n,
	) {
	}

	/**
	 * An audio file of the user that they may download.
	 *
	 * @throws ApiException
	 */
	public function file(string $uid, int $fileId): File {
		try {
			$node = $this->rootFolder->getUserFolder($uid)->getFirstNodeById($fileId);
		} catch (\Throwable) {
			$node = null;
		}
		if (!$node instanceof File || !$node->isReadable()) {
			throw ApiException::invalid($this->l10n->t('This file is not available'));
		}
		if (!str_starts_with($node->getMimetype(), 'audio/')) {
			throw ApiException::invalid($this->l10n->t('Choose audio files'));
		}
		if ($node->getSize() > self::MAX_BYTES) {
			throw ApiException::invalid($this->l10n->t('Audio files can be up to 50 MB'));
		}
		if (!self::canDownload($node->getStorage())) {
			throw ApiException::invalid($this->l10n->t('This file was shared with you without downloads'));
		}
		return $node;
	}

	/** A file shared with downloads turned off cannot be played to others. */
	private static function canDownload(IStorage $storage): bool {
		if (!$storage->instanceOfStorage(ISharedStorage::class)) {
			return true;
		}
		while (!$storage instanceof ISharedStorage && method_exists($storage, 'getWrapperStorage')) {
			$storage = $storage->getWrapperStorage();
		}
		return $storage instanceof ISharedStorage && $storage->getShare()->canDownload();
	}
}
