<?php

declare(strict_types=1);

/**
 * SPDX-FileCopyrightText: 2026 Hoang Pham
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

namespace OCA\VirtualOffice\Controller;

use OCA\VirtualOffice\Exception\ApiException;
use OCA\VirtualOffice\Service\OfficeService;
use OCA\VirtualOffice\Service\WatchService;
use OCP\AppFramework\Http;
use OCP\AppFramework\Http\Attribute\ApiRoute;
use OCP\AppFramework\Http\Attribute\NoAdminRequired;
use OCP\AppFramework\Http\Attribute\UserRateLimit;
use OCP\AppFramework\Http\DataResponse;
use OCP\AppFramework\OCSController;
use OCP\IRequest;
use OCP\IUser;
use OCP\IUserSession;

/** "Tell me when someone arrives" for one office. */
class WatchController extends OCSController {
	use ApiResponses;

	public function __construct(
		string $appName,
		IRequest $request,
		private IUserSession $userSession,
		private OfficeService $offices,
		private WatchService $watches,
	) {
		parent::__construct($appName, $request);
	}

	#[NoAdminRequired]
	#[ApiRoute(verb: 'GET', url: '/api/v1/offices/{token}/watch')]
	public function show(string $token): DataResponse {
		return $this->respond(fn () => $this->watches->get($this->user(), $this->offices->getByToken($token)));
	}

	/** Until $expiresAt (ms), usually the end of the person's day. */
	#[NoAdminRequired]
	#[UserRateLimit(limit: 30, period: 60)]
	#[ApiRoute(verb: 'PUT', url: '/api/v1/offices/{token}/watch')]
	public function update(string $token, mixed $expiresAt = null): DataResponse {
		return $this->respond(fn () => $this->watches->set($this->user(), $this->offices->getByToken($token), $expiresAt));
	}

	#[NoAdminRequired]
	#[ApiRoute(verb: 'DELETE', url: '/api/v1/offices/{token}/watch')]
	public function destroy(string $token): DataResponse {
		return $this->respond(fn () => $this->watches->clear($this->user(), $this->offices->getByToken($token)));
	}

	private function user(): IUser {
		$user = $this->userSession->getUser();
		if ($user === null) {
			throw new ApiException('AUTH_REQUIRED', Http::STATUS_UNAUTHORIZED);
		}
		return $user;
	}
}
