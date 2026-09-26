<?php

declare(strict_types=1);

/**
 * SPDX-FileCopyrightText: 2026 Hoang Pham
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

namespace OCA\VirtualOffice\Exception;

use OCP\AppFramework\Http;

/** A failure with a stable code the UI can act on. */
class ApiException extends \Exception {
	/** @param array<string, mixed> $data extra payload for the client */
	public function __construct(
		private string $apiCode,
		private int $httpStatus,
		string $message = '',
		private array $data = [],
	) {
		parent::__construct($message !== '' ? $message : $apiCode);
	}

	public function getApiCode(): string {
		return $this->apiCode;
	}

	public function getHttpStatus(): int {
		return $this->httpStatus;
	}

	/** @return array<string, mixed> */
	public function getData(): array {
		return $this->data;
	}

	public static function unavailable(): self {
		return new self('OFFICE_UNAVAILABLE', Http::STATUS_NOT_FOUND);
	}

	public static function denied(): self {
		return new self('ACTION_DENIED', Http::STATUS_FORBIDDEN);
	}

	public static function invalid(string $message): self {
		return new self('INVALID_INPUT', Http::STATUS_UNPROCESSABLE_ENTITY, $message);
	}
}
