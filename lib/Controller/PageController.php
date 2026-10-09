<?php

declare(strict_types=1);

/**
 * SPDX-FileCopyrightText: 2026 Hoang Pham
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

namespace OCA\VirtualOffice\Controller;

use OCA\VirtualOffice\AppInfo\Application;
use OCA\VirtualOffice\Exception\ApiException;
use OCA\VirtualOffice\Service\AccessPolicy;
use OCA\VirtualOffice\Service\Catalog;
use OCA\VirtualOffice\Service\OfficeService;
use OCA\VirtualOffice\Service\PushService;
use OCA\VirtualOffice\Service\RoomService;
use OCA\VirtualOffice\Service\Settings;
use OCA\VirtualOffice\Service\TalkService;
use OCP\AppFramework\Controller;
use OCP\AppFramework\Http;
use OCP\AppFramework\Http\Attribute\FrontpageRoute;
use OCP\AppFramework\Http\Attribute\NoAdminRequired;
use OCP\AppFramework\Http\Attribute\NoCSRFRequired;
use OCP\AppFramework\Http\RedirectResponse;
use OCP\AppFramework\Http\Response;
use OCP\AppFramework\Http\TemplateResponse;
use OCP\AppFramework\Services\IInitialState;
use OCP\IRequest;
use OCP\IUserSession;

class PageController extends Controller {
	public function __construct(
		string $appName,
		IRequest $request,
		private IUserSession $userSession,
		private IInitialState $initialState,
		private AccessPolicy $accessPolicy,
		private OfficeService $offices,
		private RoomService $room,
		private TalkService $talk,
		private PushService $push,
		private Settings $settings,
		private Catalog $catalog,
	) {
		parent::__construct($appName, $request);
	}

	#[NoAdminRequired]
	#[NoCSRFRequired]
	#[FrontpageRoute(verb: 'GET', url: '/')]
	public function index(): TemplateResponse {
		return $this->page('directory', null);
	}

	/** Renders the app shell only; office data is fetched through the authorized API. */
	#[NoAdminRequired]
	#[NoCSRFRequired]
	#[FrontpageRoute(verb: 'GET', url: '/o/{token}')]
	public function office(string $token): TemplateResponse {
		return $this->page('office', preg_match('/^[a-f0-9]{32}$/', $token) === 1 ? $token : null);
	}

	/**
	 * Door from a Talk conversation to its office. The office is looked up or
	 * created by the page through the API, so a GET never changes data.
	 */
	#[NoAdminRequired]
	#[NoCSRFRequired]
	#[FrontpageRoute(verb: 'GET', url: '/talk/{conversationToken}')]
	public function conversation(string $conversationToken): TemplateResponse {
		return $this->page('conversation', null, preg_match('/^[a-z0-9]{4,32}$/', $conversationToken) === 1 ? $conversationToken : null);
	}

	/** Opens the office's Talk conversation after checking office access. Never joins a call. */
	#[NoAdminRequired]
	#[NoCSRFRequired]
	#[FrontpageRoute(verb: 'GET', url: '/o/{token}/talk')]
	public function talk(string $token): Response {
		$user = $this->userSession->getUser();
		try {
			$office = $this->offices->getByToken($token);
			if ($user === null || !$this->accessPolicy->isMember($user, $office)) {
				throw ApiException::unavailable();
			}
			$url = $this->talk->conversationUrl($user, $office);
		} catch (ApiException) {
			$url = null;
		}
		if ($url === null) {
			$response = new TemplateResponse(Application::APP_ID, 'talk-unavailable', [], TemplateResponse::RENDER_AS_USER);
			$response->setStatus(Http::STATUS_NOT_FOUND);
			return $response;
		}
		return new RedirectResponse($url);
	}

	/**
	 * Leave through navigator.sendBeacon when the page closes. The CSRF token
	 * travels in the form body because beacons cannot set headers.
	 */
	#[NoAdminRequired]
	#[FrontpageRoute(verb: 'POST', url: '/beacon/leave/{token}')]
	public function leaveBeacon(string $token, string $session = ''): Response {
		$user = $this->userSession->getUser();
		if ($user !== null) {
			try {
				$this->room->leave($user, $this->offices->getByToken($token), $session);
			} catch (ApiException) {
			}
		}
		return new Response(Http::STATUS_NO_CONTENT);
	}

	private function page(string $view, ?string $token, ?string $conversation = null): TemplateResponse {
		$user = $this->userSession->getUser();
		$this->initialState->provideInitialState('config', [
			'view' => $view,
			'token' => $token,
			'conversation' => $conversation,
			'talk' => $this->talk->isAvailableForUser(),
			'uid' => $user?->getUID(),
			'isAdmin' => $user !== null && $this->accessPolicy->isAdmin($user),
			'clientPush' => $this->push->isAvailable(),
			'catalogHash' => $this->catalog->hash(),
			'roomCapacity' => $this->settings->roomCapacity(),
			'instanceOffices' => $this->settings->instanceOfficesEnabled(),
			'voice' => $this->settings->voiceEnabled(),
		]);
		return new TemplateResponse(Application::APP_ID, 'main');
	}
}
