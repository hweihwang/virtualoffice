<?php

declare(strict_types=1);

/**
 * SPDX-FileCopyrightText: 2026 Hoang Pham
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

namespace OCA\VirtualOffice\Controller;

use OCA\VirtualOffice\Exception\ApiException;
use OCA\VirtualOffice\Service\OfficeService;
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

class RoomController extends OCSController {
	use ApiResponses;

	public function __construct(
		string $appName,
		IRequest $request,
		private IUserSession $userSession,
		private OfficeService $offices,
		private RoomService $room,
	) {
		parent::__construct($appName, $request);
	}

	#[NoAdminRequired]
	#[UserRateLimit(limit: 30, period: 60)]
	#[ApiRoute(verb: 'POST', url: '/api/v1/offices/{token}/room/enter')]
	public function enter(string $token, string $session = '', bool $takeover = false): DataResponse {
		return $this->respond(fn () => $this->room->enter($this->user(), $this->offices->getByToken($token), $session, $takeover));
	}

	#[NoAdminRequired]
	#[UserRateLimit(limit: 240, period: 60)]
	#[ApiRoute(verb: 'GET', url: '/api/v1/offices/{token}/room')]
	public function poll(string $token, string $session = '', int $rev = -1): DataResponse {
		return $this->respond(fn () => $this->room->poll($this->user(), $this->offices->getByToken($token), $session, $rev));
	}

	#[NoAdminRequired]
	#[UserRateLimit(limit: 600, period: 60)]
	#[ApiRoute(verb: 'POST', url: '/api/v1/offices/{token}/room/move')]
	public function move(string $token, string $session = '', mixed $path = null): DataResponse {
		return $this->respond(fn () => $this->room->move($this->user(), $this->offices->getByToken($token), $session, $path));
	}

	#[NoAdminRequired]
	#[UserRateLimit(limit: 600, period: 60)]
	#[ApiRoute(verb: 'POST', url: '/api/v1/offices/{token}/room/stop')]
	public function stop(string $token, string $session = ''): DataResponse {
		return $this->respond(fn () => $this->room->stop($this->user(), $this->offices->getByToken($token), $session));
	}

	#[NoAdminRequired]
	#[UserRateLimit(limit: 120, period: 60)]
	#[ApiRoute(verb: 'POST', url: '/api/v1/offices/{token}/room/emote')]
	public function emote(string $token, string $session = '', mixed $emote = null): DataResponse {
		return $this->respond(fn () => $this->room->emote($this->user(), $this->offices->getByToken($token), $session, $emote));
	}

	#[NoAdminRequired]
	#[UserRateLimit(limit: 120, period: 60)]
	#[ApiRoute(verb: 'POST', url: '/api/v1/offices/{token}/room/interact')]
	public function interact(string $token, string $session = '', mixed $prop = null): DataResponse {
		return $this->respond(fn () => $this->room->interact($this->user(), $this->offices->getByToken($token), $session, $prop));
	}

	#[NoAdminRequired]
	#[UserRateLimit(limit: 120, period: 60)]
	#[ApiRoute(verb: 'POST', url: '/api/v1/offices/{token}/room/mode')]
	public function mode(string $token, string $session = '', mixed $mode = null): DataResponse {
		return $this->respond(fn () => $this->room->setMode($this->user(), $this->offices->getByToken($token), $session, $mode));
	}

	#[NoAdminRequired]
	#[UserRateLimit(limit: 60, period: 60)]
	#[ApiRoute(verb: 'POST', url: '/api/v1/offices/{token}/room/profile')]
	public function profile(string $token, string $session = ''): DataResponse {
		return $this->respond(fn () => $this->room->refreshProfile($this->user(), $this->offices->getByToken($token), $session));
	}

	/** Starts a 25 or 50 minute focus session, or joins the running one. */
	#[NoAdminRequired]
	#[UserRateLimit(limit: 60, period: 60)]
	#[ApiRoute(verb: 'POST', url: '/api/v1/offices/{token}/room/focus')]
	public function focus(string $token, string $session = '', mixed $minutes = null): DataResponse {
		return $this->respond(fn () => $this->room->joinFocus($this->user(), $this->offices->getByToken($token), $session, $minutes));
	}

	#[NoAdminRequired]
	#[UserRateLimit(limit: 60, period: 60)]
	#[ApiRoute(verb: 'POST', url: '/api/v1/offices/{token}/room/focus/leave')]
	public function leaveFocus(string $token, string $session = ''): DataResponse {
		return $this->respond(fn () => $this->room->leaveFocus($this->user(), $this->offices->getByToken($token), $session));
	}

	/** Plays the caller's audio files on the office's music player. */
	#[NoAdminRequired]
	#[UserRateLimit(limit: 30, period: 60)]
	#[ApiRoute(verb: 'POST', url: '/api/v1/offices/{token}/room/music')]
	public function music(string $token, string $session = '', mixed $tracks = null): DataResponse {
		return $this->respond(fn () => $this->room->startMusic($this->user(), $this->offices->getByToken($token), $session, $tracks));
	}

	#[NoAdminRequired]
	#[UserRateLimit(limit: 120, period: 60)]
	#[ApiRoute(verb: 'POST', url: '/api/v1/offices/{token}/room/music/stop')]
	public function stopMusic(string $token, string $session = ''): DataResponse {
		return $this->respond(fn () => $this->room->stopMusic($this->user(), $this->offices->getByToken($token), $session));
	}

	/** Voice on or off for this tab. */
	#[NoAdminRequired]
	#[UserRateLimit(limit: 30, period: 60)]
	#[ApiRoute(verb: 'POST', url: '/api/v1/offices/{token}/room/voice')]
	public function voice(string $token, string $session = '', mixed $on = null): DataResponse {
		return $this->respond(fn () => $this->room->setVoice($this->user(), $this->offices->getByToken($token), $session, $on));
	}

	/** A WebRTC offer, answer or goodbye for another tab with voice on. */
	#[NoAdminRequired]
	#[UserRateLimit(limit: 240, period: 60)]
	#[ApiRoute(verb: 'POST', url: '/api/v1/offices/{token}/room/signal')]
	public function signal(string $token, string $session = '', mixed $to = null, mixed $body = null): DataResponse {
		return $this->respond(fn () => $this->room->signal($this->user(), $this->offices->getByToken($token), $session, $to, $body));
	}

	#[NoAdminRequired]
	#[ApiRoute(verb: 'POST', url: '/api/v1/offices/{token}/room/leave')]
	public function leave(string $token, string $session = ''): DataResponse {
		return $this->respond(function () use ($token, $session) {
			$this->room->leave($this->user(), $this->offices->getByToken($token), $session);
			return [];
		});
	}

	private function user(): IUser {
		$user = $this->userSession->getUser();
		if ($user === null) {
			throw new ApiException('AUTH_REQUIRED', Http::STATUS_UNAUTHORIZED);
		}
		return $user;
	}
}
