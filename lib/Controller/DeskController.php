<?php

declare(strict_types=1);

/**
 * SPDX-FileCopyrightText: 2026 Hoang Pham
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

namespace OCA\VirtualOffice\Controller;

use OCA\VirtualOffice\Exception\ApiException;
use OCA\VirtualOffice\Service\DeskService;
use OCA\VirtualOffice\Service\OfficeService;
use OCP\AppFramework\Http;
use OCP\AppFramework\Http\Attribute\ApiRoute;
use OCP\AppFramework\Http\Attribute\NoAdminRequired;
use OCP\AppFramework\Http\Attribute\UserRateLimit;
use OCP\AppFramework\Http\DataResponse;
use OCP\AppFramework\OCSController;
use OCP\IRequest;
use OCP\IUser;
use OCP\IUserSession;

class DeskController extends OCSController {
	use ApiResponses;

	public function __construct(
		string $appName,
		IRequest $request,
		private IUserSession $userSession,
		private OfficeService $offices,
		private DeskService $desks,
	) {
		parent::__construct($appName, $request);
	}

	#[NoAdminRequired]
	#[UserRateLimit(limit: 60, period: 60)]
	#[ApiRoute(verb: 'GET', url: '/api/v1/offices/{token}/desks')]
	public function index(string $token): DataResponse {
		return $this->respond(fn () => $this->desks->list($this->user(), $this->offices->getByToken($token)));
	}

	#[NoAdminRequired]
	#[UserRateLimit(limit: 30, period: 60)]
	#[ApiRoute(verb: 'PUT', url: '/api/v1/offices/{token}/desks/{deskId}')]
	public function claim(string $token, string $deskId): DataResponse {
		return $this->respond(fn () => $this->desks->claim($this->user(), $this->offices->getByToken($token), $deskId));
	}

	#[NoAdminRequired]
	#[UserRateLimit(limit: 30, period: 60)]
	#[ApiRoute(verb: 'DELETE', url: '/api/v1/offices/{token}/desks/{deskId}')]
	public function release(string $token, string $deskId): DataResponse {
		return $this->respond(fn () => $this->desks->release($this->user(), $this->offices->getByToken($token), $deskId));
	}

	private function user(): IUser {
		$user = $this->userSession->getUser();
		if ($user === null) {
			throw new ApiException('AUTH_REQUIRED', Http::STATUS_UNAUTHORIZED);
		}
		return $user;
	}
}
