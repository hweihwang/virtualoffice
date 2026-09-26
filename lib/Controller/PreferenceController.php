<?php

declare(strict_types=1);

/**
 * SPDX-FileCopyrightText: 2026 Hoang Pham
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

namespace OCA\VirtualOffice\Controller;

use OCA\VirtualOffice\Exception\ApiException;
use OCA\VirtualOffice\Service\Clock;
use OCA\VirtualOffice\Service\PreferenceService;
use OCA\VirtualOffice\Service\RoomService;
use OCP\AppFramework\Http;
use OCP\AppFramework\Http\Attribute\ApiRoute;
use OCP\AppFramework\Http\Attribute\NoAdminRequired;
use OCP\AppFramework\Http\Attribute\UserRateLimit;
use OCP\AppFramework\Http\DataResponse;
use OCP\AppFramework\OCSController;
use OCP\IRequest;
use OCP\IUser;
use OCP\IUserSession;

class PreferenceController extends OCSController {
	use ApiResponses;

	public function __construct(
		string $appName,
		IRequest $request,
		private IUserSession $userSession,
		private PreferenceService $preferences,
		private RoomService $room,
		private Clock $clock,
	) {
		parent::__construct($appName, $request);
	}

	#[NoAdminRequired]
	#[ApiRoute(verb: 'GET', url: '/api/v1/me/preferences')]
	public function show(): DataResponse {
		return $this->respond(fn () => $this->preferences->get($this->uid()));
	}

	#[NoAdminRequired]
	#[ApiRoute(verb: 'PUT', url: '/api/v1/me/preferences')]
	public function update(int $revision = 0, mixed $preferences = null): DataResponse {
		return $this->respond(fn () => $this->preferences->set($this->uid(), $revision, $preferences));
	}

	#[NoAdminRequired]
	#[ApiRoute(verb: 'DELETE', url: '/api/v1/me/preferences')]
	public function reset(): DataResponse {
		return $this->respond(function () {
			$this->preferences->reset($this->uid());
			return ['revision' => 0, 'preferences' => null];
		});
	}

	#[NoAdminRequired]
	#[ApiRoute(verb: 'GET', url: '/api/v1/me/today')]
	public function today(): DataResponse {
		return $this->respond(fn () => ['today' => $this->preferences->today($this->uid(), $this->clock->nowMs())]);
	}

	/** Sets the "Today" note until $expiresAt (ms), or clears it with empty text. */
	#[NoAdminRequired]
	#[UserRateLimit(limit: 30, period: 60)]
	#[ApiRoute(verb: 'PUT', url: '/api/v1/me/today')]
	public function setToday(mixed $text = null, mixed $expiresAt = null): DataResponse {
		return $this->respond(fn () => $this->room->setNote($this->user(), $text, $expiresAt));
	}

	private function uid(): string {
		return $this->user()->getUID();
	}

	private function user(): IUser {
		$user = $this->userSession->getUser();
		if ($user === null) {
			throw new ApiException('AUTH_REQUIRED', Http::STATUS_UNAUTHORIZED);
		}
		return $user;
	}
}
