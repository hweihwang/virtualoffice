<?php

declare(strict_types=1);

/**
 * SPDX-FileCopyrightText: 2026 Hoang Pham
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

namespace OCA\VirtualOffice\Tests\Service;

use OCA\VirtualOffice\Exception\ApiException;
use OCA\VirtualOffice\Service\MusicLibrary;
use OCP\Files\File;
use OCP\Files\Folder;
use OCP\Files\IRootFolder;
use OCP\Files\Node;
use OCP\Files\Storage\ISharedStorage;
use OCP\Files\Storage\IStorage;
use OCP\IL10N;
use OCP\Share\IShare;
use PHPUnit\Framework\TestCase;

class MusicLibraryTest extends TestCase {
	private function library(?Node $node): MusicLibrary {
		$folder = $this->createStub(Folder::class);
		$folder->method('getFirstNodeById')->willReturn($node);
		$root = $this->createStub(IRootFolder::class);
		$root->method('getUserFolder')->willReturn($folder);
		$l10n = $this->createStub(IL10N::class);
		$l10n->method('t')->willReturnArgument(0);
		return new MusicLibrary($root, $l10n);
	}

	private function file(string $mime = 'audio/mpeg', int $size = 4_000_000, ?IStorage $storage = null, bool $readable = true): File {
		$file = $this->createStub(File::class);
		$file->method('getMimetype')->willReturn($mime);
		$file->method('getSize')->willReturn($size);
		$file->method('isReadable')->willReturn($readable);
		$file->method('getStorage')->willReturn($storage ?? $this->createStub(IStorage::class));
		return $file;
	}

	private function shared(bool $canDownload): ISharedStorage {
		$share = $this->createStub(IShare::class);
		$share->method('canDownload')->willReturn($canDownload);
		$storage = $this->createStub(ISharedStorage::class);
		$storage->method('instanceOfStorage')->willReturn(true);
		$storage->method('getShare')->willReturn($share);
		return $storage;
	}

	public function testOwnAndSharedAudioFilesPlay(): void {
		$own = $this->file();
		$this->assertSame($own, $this->library($own)->file('alice', 41));
		$shared = $this->file('audio/ogg', 1000, $this->shared(true));
		$this->assertSame($shared, $this->library($shared)->file('alice', 42));
	}

	/** @return array<string, array{0: ?string, 1: string}> */
	public static function refused(): array {
		return [
			'missing' => [null, 'This file is not available'],
			'a folder' => ['folder', 'This file is not available'],
			'unreadable' => ['unreadable', 'This file is not available'],
			'not audio' => ['video', 'Choose audio files'],
			'over 50 MB' => ['large', 'Audio files can be up to 50 MB'],
			'shared without downloads' => ['view-only', 'This file was shared with you without downloads'],
		];
	}

	#[\PHPUnit\Framework\Attributes\DataProvider('refused')]
	public function testOtherFilesAreRefused(?string $kind, string $message): void {
		$node = match ($kind) {
			null => null,
			'folder' => $this->createStub(Folder::class),
			'unreadable' => $this->file(readable: false),
			'video' => $this->file('video/mp4'),
			'large' => $this->file(size: MusicLibrary::MAX_BYTES + 1),
			'view-only' => $this->file(storage: $this->shared(false)),
		};
		try {
			$this->library($node)->file('alice', 41);
			$this->fail('Accepted ' . $kind);
		} catch (ApiException $e) {
			$this->assertSame('INVALID_INPUT', $e->getApiCode());
			$this->assertSame($message, $e->getMessage());
		}
	}
}
