<?php

declare(strict_types=1);

/**
 * SPDX-FileCopyrightText: 2026 Hoang Pham
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

namespace OCA\VirtualOffice\Controller;

use OCA\VirtualOffice\Exception\ApiException;
use OCA\VirtualOffice\Http\AudioStreamResponse;
use OCA\VirtualOffice\Service\OfficeService;
use OCA\VirtualOffice\Service\RoomService;
use OCP\AppFramework\Controller;
use OCP\AppFramework\Http;
use OCP\AppFramework\Http\Attribute\FrontpageRoute;
use OCP\AppFramework\Http\Attribute\NoAdminRequired;
use OCP\AppFramework\Http\Attribute\NoCSRFRequired;
use OCP\AppFramework\Http\Response;
use OCP\IRequest;
use OCP\IUserSession;

/** The office's music as an ordinary page route, so an <audio> element can play and seek it. */
class MusicController extends Controller {
	public function __construct(
		string $appName,
		IRequest $request,
		private IUserSession $userSession,
		private OfficeService $offices,
		private RoomService $room,
	) {
		parent::__construct($appName, $request);
	}

	/** Read-only, so no CSRF token: an <audio> element cannot send one. */
	#[NoAdminRequired]
	#[NoCSRFRequired]
	#[FrontpageRoute(verb: 'GET', url: '/o/{token}/music/{index}', requirements: ['index' => '\d{1,2}'])]
	public function stream(string $token, int $index): Response {
		$user = $this->userSession->getUser();
		try {
			if ($user === null) {
				throw new ApiException('AUTH_REQUIRED', Http::STATUS_UNAUTHORIZED);
			}
			$file = $this->room->musicTrack($user, $this->offices->getByToken($token), $index);
		} catch (ApiException $e) {
			// One answer for outsiders and members who are not inside, so the route reveals nothing.
			$response = new Response($e->getApiCode() === 'AUTH_REQUIRED' ? Http::STATUS_UNAUTHORIZED : Http::STATUS_NOT_FOUND);
			$response->addHeader('Cache-Control', 'no-store');
			return $response;
		}
		return new AudioStreamResponse($file, $this->request->getHeader('Range'));
	}
}
