<?php

declare(strict_types=1);

/**
 * SPDX-FileCopyrightText: 2026 Hoang Pham
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

namespace OCA\VirtualOffice\Controller;

use OCA\VirtualOffice\Exception\ApiException;
use OCA\VirtualOffice\Service\OfficeService;
use OCA\VirtualOffice\Service\RouletteService;
use OCP\AppFramework\Http;
use OCP\AppFramework\Http\Attribute\ApiRoute;
use OCP\AppFramework\Http\Attribute\NoAdminRequired;
use OCP\AppFramework\Http\Attribute\UserRateLimit;
use OCP\AppFramework\Http\DataResponse;
use OCP\AppFramework\OCSController;
use OCP\IRequest;
use OCP\IUser;
use OCP\IUserSession;

/** Joining and leaving an office's weekly coffee roulette. */
class RouletteController extends OCSController {
	use ApiResponses;

	public function __construct(
		string $appName,
		IRequest $request,
		private IUserSession $userSession,
		private OfficeService $offices,
		private RouletteService $roulette,
	) {
		parent::__construct($appName, $request);
	}

	#[NoAdminRequired]
	#[ApiRoute(verb: 'GET', url: '/api/v1/offices/{token}/roulette')]
	public function show(string $token): DataResponse {
		return $this->respond(fn () => $this->roulette->get($this->user(), $this->offices->getByToken($token)));
	}

	#[NoAdminRequired]
	#[UserRateLimit(limit: 30, period: 60)]
	#[ApiRoute(verb: 'PUT', url: '/api/v1/offices/{token}/roulette')]
	public function join(string $token): DataResponse {
		return $this->respond(fn () => $this->roulette->join($this->user(), $this->offices->getByToken($token)));
	}

	#[NoAdminRequired]
	#[UserRateLimit(limit: 30, period: 60)]
	#[ApiRoute(verb: 'DELETE', url: '/api/v1/offices/{token}/roulette')]
	public function leave(string $token): DataResponse {
		return $this->respond(fn () => $this->roulette->leave($this->user(), $this->offices->getByToken($token)));
	}

	private function user(): IUser {
		$user = $this->userSession->getUser();
		if ($user === null) {
			throw new ApiException('AUTH_REQUIRED', Http::STATUS_UNAUTHORIZED);
		}
		return $user;
	}
}
