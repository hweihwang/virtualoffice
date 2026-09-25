<?php

declare(strict_types=1);

/**
 * SPDX-FileCopyrightText: 2026 Hoang Pham
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

namespace OCA\VirtualOffice\Controller;

use OCA\VirtualOffice\Exception\ApiException;
use OCA\VirtualOffice\Service\KnockService;
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

class KnockController extends OCSController {
	use ApiResponses;

	public function __construct(
		string $appName,
		IRequest $request,
		private IUserSession $userSession,
		private OfficeService $offices,
		private KnockService $knocks,
	) {
		parent::__construct($appName, $request);
	}

	#[NoAdminRequired]
	#[UserRateLimit(limit: 10, period: 60)]
	#[ApiRoute(verb: 'POST', url: '/api/v1/offices/{token}/knocks')]
	public function knock(string $token, mixed $uid = null): DataResponse {
		return $this->respond(fn () => $this->knocks->knock($this->user(), $this->offices->getByToken($token), $uid), Http::STATUS_CREATED);
	}

	/** Also the target of the notification actions, so the answer may come as a query parameter. */
	#[NoAdminRequired]
	#[UserRateLimit(limit: 30, period: 60)]
	#[ApiRoute(verb: 'POST', url: '/api/v1/knocks/{id}')]
	public function answer(int $id, mixed $answer = null): DataResponse {
		return $this->respond(fn () => $this->knocks->answer($this->user(), $id, $answer));
	}

	private function user(): IUser {
		$user = $this->userSession->getUser();
		if ($user === null) {
			throw new ApiException('AUTH_REQUIRED', Http::STATUS_UNAUTHORIZED);
		}
		return $user;
	}
}
