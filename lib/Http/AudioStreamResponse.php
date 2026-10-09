<?php

declare(strict_types=1);

/**
 * SPDX-FileCopyrightText: 2026 Hoang Pham
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

namespace OCA\VirtualOffice\Http;

use OCP\AppFramework\Http;
use OCP\AppFramework\Http\ICallbackResponse;
use OCP\AppFramework\Http\IOutput;
use OCP\AppFramework\Http\Response;
use OCP\Files\File;

/**
 * Streams an audio file with support for one byte range, so an <audio>
 * element can seek to where the office's music is right now.
 *
 * @template-extends Response<Http::STATUS_*, array<string, mixed>>
 */
class AudioStreamResponse extends Response implements ICallbackResponse {
	private const CHUNK = 65_536;
	private int $start = 0;
	private int $end;

	public function __construct(
		private File $file,
		string $range,
	) {
		parent::__construct();
		$size = (int)$file->getSize();
		$this->end = $size - 1;
		$this->addHeader('Content-Type', $file->getMimetype());
		$this->addHeader('Accept-Ranges', 'bytes');
		$this->addHeader('Cache-Control', 'no-store');
		if ($range !== '') {
			$parsed = self::parseRange($range, $size);
			if ($parsed === false) {
				$this->setStatus(Http::STATUS_REQUEST_RANGE_NOT_SATISFIABLE);
				$this->addHeader('Content-Range', 'bytes */' . $size);
				$this->end = -1;
			} elseif ($parsed !== null) {
				[$this->start, $this->end] = $parsed;
				$this->setStatus(Http::STATUS_PARTIAL_CONTENT);
				$this->addHeader('Content-Range', 'bytes ' . $this->start . '-' . $this->end . '/' . $size);
			}
		}
		$this->addHeader('Content-Length', (string)max(0, $this->end - $this->start + 1));
	}

	/**
	 * One range such as "bytes=100-199", "bytes=100-" or "bytes=-500".
	 *
	 * @return array{0: int, 1: int}|false|null the first and last byte; false when not satisfiable; null to send everything
	 */
	public static function parseRange(string $header, int $size): array|false|null {
		if (preg_match('/^bytes=(\d*)-(\d*)$/', trim($header), $m) !== 1 || ($m[1] === '' && $m[2] === '')) {
			// Several ranges or another unit: the whole file is a valid answer.
			return null;
		}
		if ($m[1] === '') {
			$length = min((int)$m[2], $size);
			return $length > 0 ? [$size - $length, $size - 1] : false;
		}
		$start = (int)$m[1];
		$end = $m[2] === '' ? $size - 1 : min((int)$m[2], $size - 1);
		return $start < $size && $start <= $end ? [$start, $end] : false;
	}

	#[\Override]
	public function callback(IOutput $output) {
		if ($this->end < $this->start) {
			return;
		}
		$handle = $this->file->fopen('rb');
		if ($handle === false) {
			return;
		}
		if ($this->start > 0 && fseek($handle, $this->start) !== 0) {
			// Not seekable: read up to the start.
			for ($skip = $this->start; $skip > 0 && !feof($handle); $skip -= self::CHUNK) {
				fread($handle, min(self::CHUNK, $skip));
			}
		}
		for ($left = $this->end - $this->start + 1; $left > 0 && !feof($handle);) {
			$chunk = fread($handle, min(self::CHUNK, $left));
			if ($chunk === false || $chunk === '') {
				break;
			}
			$output->setOutput($chunk);
			$left -= strlen($chunk);
		}
		fclose($handle);
	}
}
