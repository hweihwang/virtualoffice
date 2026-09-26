<?php

declare(strict_types=1);

/**
 * SPDX-FileCopyrightText: 2026 Hoang Pham
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

namespace OCA\VirtualOffice\Controller;

use OCA\VirtualOffice\Exception\ApiException;
use OCA\VirtualOffice\Service\AccessPolicy;
use OCA\VirtualOffice\Service\OfficeService;
use OCA\VirtualOffice\Service\PushService;
use OCA\VirtualOffice\Service\RoomService;
use OCA\VirtualOffice\Service\TalkService;
use OCP\AppFramework\Http;
use OCP\AppFramework\Http\Attribute\ApiRoute;
use OCP\AppFramework\Http\Attribute\NoAdminRequired;
use OCP\AppFramework\Http\Attribute\UserRateLimit;
use OCP\AppFramework\Http\DataResponse;
use OCP\AppFramework\OCSController;
use OCP\IRequest;
use OCP\IUser;
use OCP\IUserManager;
use OCP\IUserSession;

class OfficeController extends OCSController {
	use ApiResponses;

	public function __construct(
		string $appName,
		IRequest $request,
		private IUserSession $userSession,
		private IUserManager $userManager,
		private OfficeService $offices,
		private RoomService $room,
		private AccessPolicy $accessPolicy,
		private TalkService $talk,
		private PushService $push,
	) {
		parent::__construct($appName, $request);
	}

	#[NoAdminRequired]
	#[ApiRoute(verb: 'GET', url: '/api/v1/offices')]
	public function index(string $search = '', int $limit = 50, int $offset = 0): DataResponse {
		return $this->respond(fn () => $this->page($search, $limit, $offset, null));
	}

	/**
	 * The same list, with the user's conversation tokens from Talk, so no
	 * conversation office is missed on large instances.
	 */
	#[NoAdminRequired]
	#[ApiRoute(verb: 'POST', url: '/api/v1/offices/directory')]
	public function directory(string $search = '', int $limit = 50, int $offset = 0, mixed $conversations = []): DataResponse {
		return $this->respond(function () use ($search, $limit, $offset, $conversations) {
			if (!is_array($conversations) || count($conversations) > 5000) {
				throw ApiException::invalid('Invalid conversations');
			}
			return $this->page($search, $limit, $offset, array_values(array_filter($conversations, 'is_string')));
		});
	}

	/** @param ?list<string> $conversations */
	private function page(string $search, int $limit, int $offset, ?array $conversations): array {
		$user = $this->user();
		$list = array_values(array_filter(
			$this->offices->listFor($user, $search, $limit, $offset, $conversations),
			fn ($office) => $this->accessPolicy->isMember($user, $office),
		));
		$counts = $this->room->counts($list);
		return array_map(fn ($office) => $this->offices->definition($user, $office, $counts[$office->getToken()] ?? 0), $list);
	}

	#[NoAdminRequired]
	#[UserRateLimit(limit: 20, period: 60)]
	#[ApiRoute(verb: 'POST', url: '/api/v1/offices')]
	public function create(mixed $title = null, mixed $audience = null, mixed $managerUid = null): DataResponse {
		return $this->respond(function () use ($title, $audience, $managerUid) {
			$user = $this->user();
			return $this->offices->definition($user, $this->offices->create($user, $title, $audience, $managerUid), 0);
		}, Http::STATUS_CREATED);
	}

	#[NoAdminRequired]
	#[ApiRoute(verb: 'GET', url: '/api/v1/offices/{token}')]
	public function show(string $token): DataResponse {
		return $this->respond(function () use ($token) {
			$user = $this->user();
			$office = $this->offices->getByToken($token);
			$this->accessPolicy->assertVisible($user, $office);
			return $this->offices->definition($user, $office, $this->room->counts([$office])[$token] ?? 0);
		});
	}

	#[NoAdminRequired]
	#[ApiRoute(verb: 'PATCH', url: '/api/v1/offices/{token}')]
	public function update(string $token): DataResponse {
		return $this->respond(function () use ($token) {
			$user = $this->user();
			$office = $this->offices->getByToken($token);
			$patch = [];
			foreach (['title', 'decor', 'talk'] as $key) {
				if (array_key_exists($key, $this->request->getParams())) {
					$patch[$key] = $this->request->getParam($key);
				}
			}
			foreach (array_keys($this->request->getParams()) as $key) {
				if (!in_array($key, ['title', 'decor', 'talk', 'token', 'format', '_route'], true)) {
					throw ApiException::invalid('Unknown field ' . $key);
				}
			}
			$updated = $this->offices->update($user, $office, $this->ifMatch(), $patch);
			return $this->offices->definition($user, $updated);
		});
	}

	#[NoAdminRequired]
	#[ApiRoute(verb: 'DELETE', url: '/api/v1/offices/{token}')]
	public function destroy(string $token): DataResponse {
		return $this->respond(function () use ($token) {
			$this->offices->delete($this->user(), $this->offices->getByToken($token), $this->ifMatch());
			return [];
		});
	}

	#[NoAdminRequired]
	#[ApiRoute(verb: 'GET', url: '/api/v1/offices/{token}/talk-conversations')]
	public function talkConversations(string $token): DataResponse {
		return $this->respond(function () use ($token) {
			$user = $this->user();
			$office = $this->offices->getByToken($token);
			$this->accessPolicy->assertCanManage($user, $office);
			return $this->talk->teamConversations($user, $office);
		});
	}

	/** Small, freshly authorized details for office cards in Talk, Text and other hosts. */
	#[NoAdminRequired]
	#[ApiRoute(verb: 'GET', url: '/api/v1/offices/{token}/card')]
	public function card(string $token): DataResponse {
		return $this->respond(function () use ($token) {
			$user = $this->user();
			$office = $this->offices->getByToken($token);
			if (!$this->accessPolicy->isMember($user, $office)) {
				throw ApiException::unavailable();
			}
			$this->room->revalidate($office);
			$people = $this->room->present($office);
			return [
				'token' => $token,
				'title' => $office->getTitle(),
				'audience' => $this->offices->audienceLabel($user, $office),
				'count' => $this->room->counts([$office])[$token] ?? 0,
				'people' => $people,
				'call' => $this->room->callState($office),
				'observedAt' => time(),
				'canEnter' => $this->accessPolicy->removedUntil($office, $user->getUID()) === null,
				'layoutId' => $office->getLayoutId(),
				'clientPush' => $this->push->isAvailable(),
			];
		});
	}

	/** People counts for up to 50 offices; offices the caller cannot see are left out. */
	#[NoAdminRequired]
	#[ApiRoute(verb: 'POST', url: '/api/v1/summaries')]
	public function summaries(mixed $tokens = []): DataResponse {
		return $this->respond(function () use ($tokens) {
			if (!is_array($tokens) || count($tokens) > 50) {
				throw ApiException::invalid('Up to 50 offices');
			}
			$user = $this->user();
			$visible = [];
			foreach (array_unique(array_filter($tokens, 'is_string')) as $token) {
				try {
					$office = $this->offices->getByToken($token);
					if ($this->accessPolicy->isMember($user, $office)) {
						$visible[] = $office;
					}
				} catch (ApiException) {
				}
			}
			$counts = $this->room->counts($visible);
			return array_map(static fn ($office) => ['token' => $office->getToken(), 'count' => $counts[$office->getToken()] ?? 0, 'observedAt' => time()], $visible);
		});
	}

	/** The office of a Talk conversation; created on first use by a participant. */
	#[NoAdminRequired]
	#[UserRateLimit(limit: 30, period: 60)]
	#[ApiRoute(verb: 'POST', url: '/api/v1/conversations/{conversationToken}/office')]
	public function conversationOffice(string $conversationToken): DataResponse {
		return $this->respond(function () use ($conversationToken) {
			$user = $this->user();
			[$office, $created] = $this->offices->forConversation($user, $conversationToken);
			return ['office' => $this->offices->definition($user, $office, $this->room->counts([$office])[$office->getToken()] ?? 0), 'created' => $created];
		});
	}

	/** Team offices of the Teams this conversation belongs to. */
	#[NoAdminRequired]
	#[UserRateLimit(limit: 60, period: 60)]
	#[ApiRoute(verb: 'GET', url: '/api/v1/conversations/{conversationToken}/team-offices')]
	public function teamOffices(string $conversationToken): DataResponse {
		return $this->respond(fn () => $this->offices->teamOfficesOf($this->user(), $conversationToken));
	}

	/** Deck boards, folders, conversations and more shared with the office's Team. */
	#[NoAdminRequired]
	#[UserRateLimit(limit: 60, period: 60)]
	#[ApiRoute(verb: 'GET', url: '/api/v1/offices/{token}/resources')]
	public function resources(string $token): DataResponse {
		return $this->respond(fn () => $this->offices->teamResources($this->user(), $this->offices->getByToken($token)));
	}

	#[NoAdminRequired]
	#[ApiRoute(verb: 'GET', url: '/api/v1/audiences')]
	public function audiences(string $search = ''): DataResponse {
		return $this->respond(fn () => $this->offices->audienceOptions($this->user(), $search));
	}

	/** Audience members matching a search, for choosing managers. */
	#[NoAdminRequired]
	#[UserRateLimit(limit: 60, period: 60)]
	#[ApiRoute(verb: 'GET', url: '/api/v1/offices/{token}/people')]
	public function people(string $token, string $search = ''): DataResponse {
		return $this->respond(function () use ($token, $search) {
			$user = $this->user();
			$office = $this->offices->getByToken($token);
			$this->accessPolicy->assertCanManage($user, $office);
			$result = [];
			foreach ($this->userManager->searchDisplayName(trim($search), 25) as $candidate) {
				if (count($result) < 10 && $this->accessPolicy->isMember($candidate, $office)) {
					$result[] = ['uid' => $candidate->getUID(), 'displayName' => $candidate->getDisplayName()];
				}
			}
			return $result;
		});
	}

	#[NoAdminRequired]
	#[ApiRoute(verb: 'PUT', url: '/api/v1/offices/{token}/managers')]
	public function addManager(string $token, mixed $uid = null): DataResponse {
		return $this->respond(function () use ($token, $uid) {
			$user = $this->user();
			return $this->offices->definition($user, $this->offices->addManager($user, $this->offices->getByToken($token), $uid));
		});
	}

	#[NoAdminRequired]
	#[ApiRoute(verb: 'DELETE', url: '/api/v1/offices/{token}/managers')]
	public function removeManager(string $token, mixed $uid = null): DataResponse {
		return $this->respond(function () use ($token, $uid) {
			$user = $this->user();
			return $this->offices->definition($user, $this->offices->removeManager($user, $this->offices->getByToken($token), $uid));
		});
	}

	#[NoAdminRequired]
	#[ApiRoute(verb: 'PUT', url: '/api/v1/offices/{token}/removals')]
	public function removePerson(string $token, mixed $uid = null, mixed $minutes = null): DataResponse {
		return $this->respond(function () use ($token, $uid, $minutes) {
			$user = $this->user();
			return $this->offices->definition($user, $this->offices->removePerson($user, $this->offices->getByToken($token), $uid, $minutes));
		});
	}

	#[NoAdminRequired]
	#[ApiRoute(verb: 'DELETE', url: '/api/v1/offices/{token}/removals')]
	public function liftRemoval(string $token, mixed $uid = null): DataResponse {
		return $this->respond(function () use ($token, $uid) {
			$user = $this->user();
			return $this->offices->definition($user, $this->offices->liftRemoval($user, $this->offices->getByToken($token), $uid));
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
