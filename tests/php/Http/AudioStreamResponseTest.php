<?php

declare(strict_types=1);

/**
 * SPDX-FileCopyrightText: 2026 Hoang Pham
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

namespace OCA\VirtualOffice\Tests\Http;

use OCA\VirtualOffice\Http\AudioStreamResponse;
use OCP\AppFramework\Http\IOutput;
use OCP\AppFramework\Http\Response;
use OCP\Files\File;
use PHPUnit\Framework\TestCase;

class AudioStreamResponseTest extends TestCase {
	public function testRangesAreReadLikeBrowsersSendThem(): void {
		$this->assertSame([100, 199], AudioStreamResponse::parseRange('bytes=100-199', 1000));
		$this->assertSame([100, 999], AudioStreamResponse::parseRange('bytes=100-', 1000));
		$this->assertSame([500, 999], AudioStreamResponse::parseRange('bytes=-500', 1000));
		$this->assertSame([0, 999], AudioStreamResponse::parseRange('bytes=0-5000', 1000));
		$this->assertFalse(AudioStreamResponse::parseRange('bytes=1000-', 1000));
		$this->assertFalse(AudioStreamResponse::parseRange('bytes=-0', 1000));
		$this->assertNull(AudioStreamResponse::parseRange('bytes=0-1,5-9', 1000));
		$this->assertNull(AudioStreamResponse::parseRange('items=0-1', 1000));
	}

	private function file(string $content): File {
		$file = $this->createStub(File::class);
		$file->method('getSize')->willReturn(strlen($content));
		$file->method('getMimetype')->willReturn('audio/mpeg');
		$file->method('fopen')->willReturnCallback(function () use ($content) {
			$handle = fopen('php://memory', 'w+b');
			fwrite($handle, $content);
			rewind($handle);
			return $handle;
		});
		return $file;
	}

	/** The headers set by the response; getHeaders() needs a running server. */
	private function headers(AudioStreamResponse $response): array {
		return (new \ReflectionProperty(Response::class, 'headers'))->getValue($response);
	}

	private function body(AudioStreamResponse $response): string {
		$body = '';
		$output = $this->createStub(IOutput::class);
		$output->method('setOutput')->willReturnCallback(function (string $chunk) use (&$body) {
			$body .= $chunk;
		});
		$response->callback($output);
		return $body;
	}

	public function testARangeAnswersWithPartialContent(): void {
		$response = new AudioStreamResponse($this->file('0123456789'), 'bytes=3-6');
		$this->assertSame(206, $response->getStatus());
		$this->assertSame('bytes 3-6/10', $this->headers($response)['Content-Range']);
		$this->assertSame('4', $this->headers($response)['Content-Length']);
		$this->assertSame('bytes', $this->headers($response)['Accept-Ranges']);
		$this->assertSame('3456', $this->body($response));
	}

	public function testWithoutARangeTheWholeFileIsSent(): void {
		$response = new AudioStreamResponse($this->file('0123456789'), '');
		$this->assertSame(200, $response->getStatus());
		$this->assertSame('10', $this->headers($response)['Content-Length']);
		$this->assertSame('audio/mpeg', $this->headers($response)['Content-Type']);
		$this->assertSame('0123456789', $this->body($response));
	}

	public function testARangePastTheEndIsRefused(): void {
		$response = new AudioStreamResponse($this->file('0123456789'), 'bytes=20-');
		$this->assertSame(416, $response->getStatus());
		$this->assertSame('bytes */10', $this->headers($response)['Content-Range']);
		$this->assertSame('', $this->body($response));
	}
}
