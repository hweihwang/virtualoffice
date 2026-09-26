<?php

declare(strict_types=1);

/**
 * SPDX-FileCopyrightText: 2026 Hoang Pham
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

namespace OCA\VirtualOffice\Controller;

use OCA\VirtualOffice\Exception\ApiException;
use OCP\AppFramework\Http;
use OCP\AppFramework\Http\DataResponse;

trait ApiResponses {
	/** Runs $fn and maps ApiException to a coded error. Private data is never cached. */
	protected function respond(callable $fn, int $status = Http::STATUS_OK): DataResponse {
		try {
			$result = $fn();
			$response = $result instanceof DataResponse ? $result : new DataResponse($result, $status);
		} catch (ApiException $e) {
			$response = new DataResponse([
				'code' => $e->getApiCode(),
				'message' => $e->getMessage(),
				'data' => $e->getData(),
			], $e->getHttpStatus());
			if ($e->getHttpStatus() === Http::STATUS_TOO_MANY_REQUESTS) {
				$response->addHeader('Retry-After', '1');
			}
		}
		$response->addHeader('Cache-Control', 'no-store');
		return $response;
	}

	/** Revision from an If-Match header such as "3" or W/"3". */
	protected function ifMatch(): int {
		$value = trim($this->request->getHeader('If-Match'), " \t\"W/");
		if (preg_match('/^\d+$/', $value) !== 1) {
			throw new ApiException('REVISION_REQUIRED', Http::STATUS_PRECONDITION_REQUIRED, 'Missing If-Match revision');
		}
		return (int)$value;
	}
}
