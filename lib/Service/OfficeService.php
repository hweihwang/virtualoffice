<?php

declare(strict_types=1);

/**
 * SPDX-FileCopyrightText: 2026 Hoang Pham
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

namespace OCA\VirtualOffice\Service;

use OCA\VirtualOffice\AppInfo\Application;
use OCA\VirtualOffice\Db\Office;
use OCA\VirtualOffice\Db\OfficeMapper;
use OCA\VirtualOffice\Exception\ApiException;
use OCP\AppFramework\Db\DoesNotExistException;
use OCP\AppFramework\Http;
use OCP\IGroupManager;
use OCP\IL10N;
use OCP\IURLGenerator;
use OCP\IUser;
use OCP\IUserManager;
use OCP\Security\ISecureRandom;
use OCP\Teams\ITeamManager;

class OfficeService {
	public const MAX_MANAGERS = 20;
	public const REMOVAL_MINUTES = [15, 60, 1440];
	/** Offices considered per directory listing; more than any person is expected to belong to. */
	private const LIST_CAP = 500;

	public function __construct(
		private OfficeMapper $mapper,
		private AccessPolicy $accessPolicy,
		private RoomService $room,
		private TalkService $talk,
		private ConversationService $conversations,
		private Catalog $catalog,
		private Settings $settings,
		private Clock $clock,
		private ITeamManager $teamManager,
		private IGroupManager $groupManager,
		private IUserManager $userManager,
		private ISecureRandom $random,
		private IURLGenerator $urlGenerator,
		private IL10N $l10n,
	) {
	}

	/** @throws ApiException */
	public function getByToken(string $token): Office {
		if (preg_match('/^[a-f0-9]{32}$/', $token) !== 1) {
			throw ApiException::unavailable();
		}
		try {
			return $this->mapper->findByToken($token);
		} catch (DoesNotExistException) {
			throw ApiException::unavailable();
		}
	}

	/**
	 * Offices of the user's Teams and groups, plus offices of Talk
	 * conversations they take part in (checked one by one with Talk).
	 *
	 * @param ?list<string> $conversations the user's conversation tokens, as Talk lists them
	 * @return list<Office>
	 */
	public function listFor(IUser $user, string $search, int $limit, int $offset, ?array $conversations = null): array {
		return array_slice($this->allFor($user, $search, $conversations), max(0, $offset), max(1, min(50, $limit)));
	}

	/**
	 * Every office the user belongs to, closest audiences first. One ordering
	 * for every page, so paging neither skips nor repeats offices.
	 *
	 * Talk has no public API to list a user's conversations. With the tokens
	 * the browser got from Talk, their offices are looked up directly and
	 * participation is still checked here; without them, only the LIST_CAP
	 * most recently updated conversation offices are checked.
	 *
	 * @param ?list<string> $conversations
	 * @return list<Office>
	 */
	public function allFor(IUser $user, string $search = '', ?array $conversations = null): array {
		$search = mb_substr(trim($search), 0, 120);
		$offices = $this->mapper->findByAudienceKeys($this->accessPolicy->audienceKeysFor($user), $search, self::LIST_CAP, 0);
		if ($this->accessPolicy->isUsable($user) && $this->conversations->isAvailable()) {
			$candidates = $conversations === null
				? $this->mapper->findByKind(AccessPolicy::KIND_TALK, $search, self::LIST_CAP)
				: $this->mapper->findTalkByTokens(array_values(array_unique(array_filter($conversations, ConversationService::isToken(...)))), $search);
			foreach ($candidates as $office) {
				if ($this->conversations->isParticipant($user, $office->getAudienceId())) {
					$offices[] = $office;
				}
			}
		}
		$rank = array_flip([AccessPolicy::KIND_TEAM, AccessPolicy::KIND_TALK, AccessPolicy::KIND_GROUP, AccessPolicy::KIND_INSTANCE]);
		usort($offices, static fn (Office $a, Office $b) => ($rank[$a->getAudienceKind()] ?? 9) <=> ($rank[$b->getAudienceKind()] ?? 9)
			?: strcasecmp($a->getTitle(), $b->getTitle()) ?: $a->getId() <=> $b->getId());
		return $offices;
	}

	/** Team resources shown as objects in the room. */
	public const RESOURCE_SLOTS = 6;

	/**
	 * Resources shared with the office's Team, such as Deck boards, folders
	 * and Talk conversations, as the Team page lists them for this member.
	 *
	 * @return list<array{provider: string, id: string, label: string, url: string, iconUrl: ?string, iconSvg: ?string, iconEmoji: ?string}>
	 * @throws ApiException
	 */
	public function teamResources(IUser $user, Office $office): array {
		$this->accessPolicy->assertCanEnter($user, $office);
		if ($office->getAudienceKind() !== AccessPolicy::KIND_TEAM || !$this->teamManager->hasTeamSupport()) {
			return [];
		}
		try {
			$shared = $this->teamManager->getSharedWith($office->getAudienceId(), $user->getUID());
		} catch (\Throwable) {
			return [];
		}
		$resources = [];
		foreach ($shared as $resource) {
			if ($resource->getProvider()->getId() === Application::APP_ID) {
				continue;
			}
			$resources[] = [
				'provider' => $resource->getProvider()->getId(),
				'id' => $resource->getId(),
				'label' => $resource->getLabel(),
				'url' => $resource->getUrl(),
				'iconUrl' => $resource->getIconURL(),
				'iconSvg' => $resource->getIconSvg(),
				'iconEmoji' => $resource->getIconEmoji(),
			];
			if (count($resources) === self::RESOURCE_SLOTS) {
				break;
			}
		}
		return $resources;
	}

	/**
	 * Offices of the Teams a conversation belongs to, so a conversation
	 * office can point to the Team's own office.
	 *
	 * @return list<array{token: string, title: string, url: string}>
	 */
	public function teamOfficesOf(IUser $user, string $conversation): array {
		if (!ConversationService::isToken($conversation) || !$this->teamManager->hasTeamSupport() || !$this->conversations->isParticipant($user, $conversation)) {
			return [];
		}
		try {
			$teams = $this->teamManager->getTeamsForResource('talk', $conversation, $user->getUID());
		} catch (\Throwable) {
			return [];
		}
		$teamIds = array_map(static fn ($team) => $team->getId(), $teams);
		$result = [];
		foreach ($this->mapper->findByAudienceKeys($this->accessPolicy->audienceKeysFor($user), '', self::LIST_CAP, 0) as $office) {
			if ($office->getAudienceKind() === AccessPolicy::KIND_TEAM && in_array($office->getAudienceId(), $teamIds, true)) {
				$result[] = [
					'token' => $office->getToken(),
					'title' => $office->getTitle(),
					'url' => $this->urlGenerator->linkToRouteAbsolute('virtualoffice.page.office', ['token' => $office->getToken()]),
				];
			}
		}
		return $result;
	}

	/**
	 * The office of a Talk conversation, created on first use by any
	 * participant, who becomes its manager.
	 *
	 * @return array{0: Office, 1: bool} the office and whether it was just created
	 * @throws ApiException
	 */
	public function forConversation(IUser $user, mixed $token): array {
		if (!ConversationService::isToken($token) || !$this->accessPolicy->isUsable($user)
			|| !$this->accessPolicy->isConversationParticipant($user, $token)) {
			throw ApiException::unavailable();
		}
		/** @var string $token */
		$existing = $this->mapper->findByAudienceKeys([AccessPolicy::audienceKey(AccessPolicy::KIND_TALK, $token)], '', 1, 0);
		if ($existing !== []) {
			return [$existing[0], false];
		}
		$details = $this->conversations->details($token);
		if ($details === null || $details['type'] === 'one2one') {
			throw new ApiException('CONVERSATION_NOT_SUPPORTED', Http::STATUS_UNPROCESSABLE_ENTITY, 'Offices are available for group and public conversations');
		}
		$name = mb_substr(trim($details['name']), 0, 120);
		$office = $this->newOffice(AccessPolicy::KIND_TALK, $token, $name !== '' ? $name : $this->l10n->t('Conversation office'), [$user->getUID()], $user);
		$office->setConfig(json_encode(['decor' => $this->catalog->validateDecor([]), 'talk' => ['source' => 'conversation', 'token' => $token, 'label' => $office->getTitle()]], JSON_THROW_ON_ERROR));
		$office->setTalkToken($token);
		$office = $this->mapper->insert($office);
		// If another participant created one at the same moment, keep the older office.
		$all = $this->mapper->findByTalkToken($token);
		$first = array_reduce($all, static fn (?Office $carry, Office $o) => $o->getAudienceKind() === AccessPolicy::KIND_TALK && ($carry === null || $o->getId() < $carry->getId()) ? $o : $carry);
		if ($first !== null && $first->getId() !== $office->getId()) {
			$this->mapper->delete($office);
			return [$first, false];
		}
		return [$office, true];
	}

	/** @throws ApiException */
	public function create(IUser $user, mixed $title, mixed $audience, mixed $managerUid): Office {
		$title = $this->cleanTitle($title);
		if (!is_array($audience) || !is_string($audience['kind'] ?? null) || !is_string($audience['id'] ?? null)) {
			throw ApiException::invalid('Choose who the office is for');
		}
		$kind = $audience['kind'];
		$id = $audience['id'];
		$isAdmin = $this->accessPolicy->isAdmin($user);
		if (!$this->accessPolicy->isUsable($user)) {
			throw ApiException::denied();
		}
		switch ($kind) {
			case AccessPolicy::KIND_TEAM:
				if (!$this->accessPolicy->isTeamMember($user, $id)) {
					throw ApiException::denied();
				}
				$managers = [$user->getUID()];
				break;
			case AccessPolicy::KIND_GROUP:
				if (!$isAdmin) {
					throw ApiException::denied();
				}
				if (!$this->groupManager->groupExists($id)) {
					throw ApiException::invalid('Unknown group');
				}
				$managers = $this->initialManagers($managerUid, fn (string $uid) => $this->groupManager->isInGroup($uid, $id));
				break;
			case AccessPolicy::KIND_TALK:
				return $this->forConversation($user, $id)[0];
			case AccessPolicy::KIND_INSTANCE:
				if (!$isAdmin || !$this->settings->instanceOfficesEnabled()) {
					throw ApiException::denied();
				}
				$id = AccessPolicy::INSTANCE_ID;
				$managers = $this->initialManagers($managerUid, fn (string $uid) => true);
				break;
			default:
				throw ApiException::invalid('Choose who the office is for');
		}

		return $this->mapper->insert($this->newOffice($kind, $id, $title, $managers, $user));
	}

	/** @param list<string> $managers */
	private function newOffice(string $kind, string $id, string $title, array $managers, IUser $user): Office {
		$now = $this->clock->nowMs();
		$office = new Office();
		$office->setToken($this->random->generate(32, '0123456789abcdef'));
		$office->setAudienceKind($kind);
		$office->setAudienceId($id);
		$office->setAudienceKey(AccessPolicy::audienceKey($kind, $id));
		$office->setTitle($title);
		$office->setLayoutId($this->catalog->defaultLayoutId());
		$office->setConfig(json_encode(['decor' => $this->catalog->validateDecor([]), 'talk' => null], JSON_THROW_ON_ERROR));
		$office->setManagers(json_encode($managers, JSON_THROW_ON_ERROR));
		$office->setRemovals('{}');
		$office->setRoomState('{}');
		$office->setConfigRev(1);
		$office->setPresenceRev(0);
		$office->setCreatedBy($user->getUID());
		$office->setCreatedAt($now);
		$office->setUpdatedAt($now);
		$office->markAllFieldsUpdated();
		return $office;
	}

	/**
	 * @param array<string, mixed> $patch title, decor and/or talk
	 * @throws ApiException
	 */
	public function update(IUser $user, Office $office, int $expectedRev, array $patch): Office {
		$this->accessPolicy->assertCanManage($user, $office);
		if (array_diff(array_keys($patch), ['title', 'decor', 'talk']) !== [] || $patch === []) {
			throw ApiException::invalid('Only the title, decor and Talk link can be changed');
		}
		$config = $office->getConfigData();
		if ($office->getAudienceKind() === AccessPolicy::KIND_TALK && (array_key_exists('title', $patch) || array_key_exists('talk', $patch))) {
			throw ApiException::invalid('A conversation office keeps the conversation name and link');
		}
		if (array_key_exists('title', $patch)) {
			$office->setTitle($this->cleanTitle($patch['title']));
		}
		if (array_key_exists('decor', $patch)) {
			$config['decor'] = $this->catalog->validateDecor($patch['decor']);
		}
		$relinked = false;
		if (array_key_exists('talk', $patch)) {
			$config['talk'] = $this->talk->validateBinding($user, $office, $patch['talk']);
			$relinked = ($config['talk']['token'] ?? null) !== $office->getTalkToken();
			$office->setTalkToken($config['talk']['token'] ?? null);
		}
		$office->setConfig(json_encode($config, JSON_THROW_ON_ERROR));
		$office = $this->save($office, $expectedRev);
		if ($relinked) {
			// A different conversation: its call state is unknown until Talk reports it.
			$this->room->forgetCall($office);
		}
		return $office;
	}

	/** @throws ApiException */
	public function delete(IUser $user, Office $office, int $expectedRev): void {
		$this->accessPolicy->assertCanManage($user, $office);
		$this->room->deleteOffice($office, $expectedRev);
	}

	/** @throws ApiException */
	public function addManager(IUser $user, Office $office, mixed $uid): Office {
		$this->accessPolicy->assertCanManage($user, $office);
		$target = is_string($uid) ? $this->userManager->get($uid) : null;
		if ($target === null || !$this->accessPolicy->isMember($target, $office)) {
			throw ApiException::invalid('Managers must belong to the office audience');
		}
		$managers = $office->getManagerList();
		if (in_array($target->getUID(), $managers, true)) {
			return $office;
		}
		if (count($managers) >= self::MAX_MANAGERS) {
			throw ApiException::invalid('An office can have up to 20 managers');
		}
		$managers[] = $target->getUID();
		$office->setManagers(json_encode($managers, JSON_THROW_ON_ERROR));
		return $this->save($office, $office->getConfigRev());
	}

	/** @throws ApiException */
	public function removeManager(IUser $user, Office $office, mixed $uid): Office {
		$this->accessPolicy->assertCanManage($user, $office);
		$managers = $office->getManagerList();
		if (!in_array($uid, $managers, true)) {
			return $office;
		}
		if (count($managers) === 1 && !$this->accessPolicy->isAdmin($user)) {
			throw new ApiException('LAST_MANAGER', Http::STATUS_CONFLICT, 'Add another manager first');
		}
		$office->setManagers(json_encode(array_values(array_diff($managers, [$uid])), JSON_THROW_ON_ERROR));
		return $this->save($office, $office->getConfigRev());
	}

	/**
	 * Takes someone out of the office for a while. Managers cannot remove
	 * other managers; admins can.
	 *
	 * @throws ApiException
	 */
	public function removePerson(IUser $user, Office $office, mixed $uid, mixed $minutes): Office {
		$this->accessPolicy->assertCanManage($user, $office);
		if (!is_string($uid) || $uid === $user->getUID() || !in_array($minutes, self::REMOVAL_MINUTES, true)) {
			throw ApiException::invalid('Invalid removal');
		}
		if (in_array($uid, $office->getManagerList(), true) && !$this->accessPolicy->isAdmin($user)) {
			throw ApiException::denied();
		}
		$now = $this->clock->nowMs();
		$removals = array_filter($office->getRemovalMap(), static fn (int $until) => $until > $now);
		$removals[$uid] = $now + $minutes * 60_000;
		if (count($removals) > 200) {
			throw ApiException::invalid('Too many active removals');
		}
		$office->setRemovals(json_encode($removals, JSON_THROW_ON_ERROR | JSON_FORCE_OBJECT));
		$office = $this->save($office, $office->getConfigRev(), false);
		$this->room->evict($uid, $office->getId(), 'removed');
		return $office;
	}

	/** @throws ApiException */
	public function liftRemoval(IUser $user, Office $office, mixed $uid): Office {
		$this->accessPolicy->assertCanManage($user, $office);
		$removals = $office->getRemovalMap();
		if (!is_string($uid) || !isset($removals[$uid])) {
			return $office;
		}
		unset($removals[$uid]);
		$office->setRemovals(json_encode($removals, JSON_THROW_ON_ERROR | JSON_FORCE_OBJECT));
		return $this->save($office, $office->getConfigRev(), false);
	}

	/** Data a visible office exposes to the caller. */
	public function definition(IUser $user, Office $office, ?int $count = null): array {
		$isMember = $this->unlessUnavailable(fn () => $this->accessPolicy->isMember($user, $office));
		$canManage = $this->unlessUnavailable(fn () => $this->accessPolicy->canManage($user, $office));
		$config = $office->getConfigData();
		$talk = $config['talk'];
		$chatUrl = $isMember ? $this->talk->conversationUrl($user, $office) : null;
		$result = [
			'token' => $office->getToken(),
			'title' => $office->getTitle(),
			'audience' => [
				'kind' => $office->getAudienceKind(),
				'id' => $office->getAudienceId(),
				'label' => $this->audienceLabel($user, $office),
			],
			'layoutId' => $office->getLayoutId(),
			'revision' => $office->getConfigRev(),
			'config' => [
				'decor' => $this->catalog->validateDecor($config['decor']),
				// The token is in the chat link anyway; members need it to post the office there.
				'talk' => $talk === null ? null : ['source' => $talk['source'], 'label' => $talk['label']] + ($canManage || $chatUrl !== null ? ['token' => $talk['token']] : []),
			],
			'permissions' => [
				'isMember' => $isMember,
				'canEnter' => $isMember && $this->accessPolicy->removedUntil($office, $user->getUID()) === null,
				'canManage' => $canManage,
			],
			'removedUntil' => $this->accessPolicy->removedUntil($office, $user->getUID()),
			'talkAvailable' => $talk !== null && $this->talk->isAvailableForUser(),
			'call' => $isMember ? $this->room->callState($office) : null,
			'links' => $isMember ? ['chat' => $chatUrl, 'call' => $chatUrl === null ? null : $chatUrl . '#direct-call'] : null,
			'url' => $this->urlGenerator->linkToRouteAbsolute('virtualoffice.page.office', ['token' => $office->getToken()]),
			'count' => $count,
		];
		if ($canManage) {
			$result['managers'] = array_map(fn (string $uid) => [
				'uid' => $uid,
				'displayName' => $this->userManager->getDisplayName($uid) ?? $uid,
			], $office->getManagerList());
			$now = $this->clock->nowMs();
			$removals = [];
			foreach ($office->getRemovalMap() as $uid => $until) {
				if ($until > $now) {
					$removals[] = ['uid' => (string)$uid, 'displayName' => $this->userManager->getDisplayName((string)$uid) ?? (string)$uid, 'until' => $until];
				}
			}
			$result['removals'] = $removals;
		}
		return $result;
	}

	public function audienceLabel(IUser $user, Office $office): string {
		switch ($office->getAudienceKind()) {
			case AccessPolicy::KIND_TEAM:
				try {
					foreach ($this->accessPolicy->teamsOf($user) as $team) {
						if ($team->getId() === $office->getAudienceId()) {
							return $team->getDisplayName();
						}
					}
				} catch (ApiException) {
				}
				if ($this->accessPolicy->isAdmin($user)) {
					return $this->teamManager->getTeam($office->getAudienceId())?->getDisplayName() ?? $this->l10n->t('Team');
				}
				return $this->l10n->t('Team');
			case AccessPolicy::KIND_GROUP:
				return $this->groupManager->get($office->getAudienceId())?->getDisplayName() ?? $office->getAudienceId();
			case AccessPolicy::KIND_TALK:
				return $this->conversations->details($office->getAudienceId())['name'] ?? $office->getTitle();
			default:
				return $this->l10n->t('Everyone');
		}
	}

	/**
	 * Audiences the caller may create an office for.
	 *
	 * @return list<array{kind: string, id: string, label: string}>
	 */
	public function audienceOptions(IUser $user, string $search): array {
		$search = mb_strtolower(trim($search));
		$options = [];
		try {
			foreach ($this->accessPolicy->teamsOf($user) as $team) {
				if ($search === '' || str_contains(mb_strtolower($team->getDisplayName()), $search)) {
					$options[] = ['kind' => AccessPolicy::KIND_TEAM, 'id' => $team->getId(), 'label' => $team->getDisplayName()];
				}
			}
		} catch (ApiException) {
		}
		if ($this->accessPolicy->isAdmin($user)) {
			foreach ($this->groupManager->search($search, 20) as $group) {
				$options[] = ['kind' => AccessPolicy::KIND_GROUP, 'id' => $group->getGID(), 'label' => $group->getDisplayName()];
			}
			if ($this->settings->instanceOfficesEnabled()) {
				$options[] = ['kind' => AccessPolicy::KIND_INSTANCE, 'id' => AccessPolicy::INSTANCE_ID, 'label' => $this->l10n->t('Everyone')];
			}
		}
		return $options;
	}

	/** False instead of an error while the audience backend (Teams, Talk) is unavailable. */
	private function unlessUnavailable(callable $check): bool {
		try {
			return (bool)$check();
		} catch (ApiException $e) {
			if ($e->getApiCode() === 'AUDIENCE_UNAVAILABLE') {
				return false;
			}
			throw $e;
		}
	}

	/** @throws ApiException */
	private function save(Office $office, int $expectedRev, bool $announce = true): Office {
		$office->setUpdatedAt($this->clock->nowMs());
		if (!$this->mapper->updateIfRevision($office, $expectedRev)) {
			throw $this->revisionMismatch($this->mapper->findById($office->getId()));
		}
		if ($announce) {
			$this->room->announceConfig($office);
		}
		return $office;
	}

	private function revisionMismatch(Office $office): ApiException {
		return new ApiException('REVISION_MISMATCH', Http::STATUS_PRECONDITION_FAILED, 'Someone else changed this office', ['revision' => $office->getConfigRev()]);
	}

	/**
	 * @param callable(string): bool $isMember
	 * @return list<string>
	 * @throws ApiException
	 */
	private function initialManagers(mixed $uid, callable $isMember): array {
		$target = is_string($uid) && $uid !== '' ? $this->userManager->get($uid) : null;
		if ($target === null || !$target->isEnabled() || !$isMember($target->getUID())) {
			throw ApiException::invalid('Choose a manager who belongs to the audience');
		}
		return [$target->getUID()];
	}

	/** @throws ApiException */
	private function cleanTitle(mixed $title): string {
		if (!is_string($title)) {
			throw ApiException::invalid('Give the office a name');
		}
		$title = trim((string)preg_replace('/[\p{Cc}\p{Cf}]/u', '', $title));
		if ($title === '' || mb_strlen($title) > 120) {
			throw ApiException::invalid('Office names have 1 to 120 characters');
		}
		return $title;
	}
}
