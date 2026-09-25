<?php

declare(strict_types=1);

/**
 * SPDX-FileCopyrightText: 2026 Hoang Pham
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

namespace OCA\VirtualOffice\Service;

use OCA\VirtualOffice\AppInfo\Application;
use OCA\VirtualOffice\Db\Office;
use OCA\VirtualOffice\Exception\ApiException;
use OCP\App\IAppManager;
use OCP\AppFramework\Http;
use OCP\IGroupManager;
use OCP\IUser;
use OCP\Teams\ITeamManager;
use OCP\Teams\Team;
use Psr\Log\LoggerInterface;

/**
 * Every read of private office data and every change goes through here.
 * Membership comes from the live Team/group backends; nothing is cached
 * beyond the current request.
 */
class AccessPolicy {
	public const KIND_TEAM = 'team';
	public const KIND_GROUP = 'group';
	public const KIND_INSTANCE = 'instance';
	public const KIND_TALK = 'talk';
	public const INSTANCE_ID = 'instance';

	/** @var array<string, list<Team>> */
	private array $teams = [];

	public function __construct(
		private ITeamManager $teamManager,
		private IGroupManager $groupManager,
		private IAppManager $appManager,
		private Settings $settings,
		private Clock $clock,
		private ConversationService $conversations,
		private LoggerInterface $logger,
	) {
	}

	public static function audienceKey(string $kind, string $id): string {
		return hash('sha256', $kind . "\0" . $id);
	}

	public function isUsable(IUser $user): bool {
		return $user->isEnabled() && $this->appManager->isEnabledForUser(Application::APP_ID, $user);
	}

	public function isAdmin(IUser $user): bool {
		return $this->groupManager->isAdmin($user->getUID());
	}

	/**
	 * @return list<Team> Teams the user is a member of
	 * @throws ApiException when the Team backend fails
	 */
	public function teamsOf(IUser $user): array {
		$uid = $user->getUID();
		if (!isset($this->teams[$uid])) {
			if (!$this->teamManager->hasTeamSupport()) {
				$this->teams[$uid] = [];
			} else {
				try {
					$this->teams[$uid] = $this->teamManager->getTeamsForUser($uid);
				} catch (\Throwable $e) {
					$this->logger->warning('Could not read Team memberships', ['exception' => $e]);
					throw new ApiException('AUDIENCE_UNAVAILABLE', Http::STATUS_SERVICE_UNAVAILABLE);
				}
			}
		}
		return $this->teams[$uid];
	}

	/** @throws ApiException */
	public function isMember(IUser $user, Office $office): bool {
		if (!$this->isUsable($user)) {
			return false;
		}
		return match ($office->getAudienceKind()) {
			self::KIND_TEAM => $this->isTeamMember($user, $office->getAudienceId()),
			self::KIND_GROUP => $this->groupManager->isInGroup($user->getUID(), $office->getAudienceId()),
			self::KIND_INSTANCE => $this->settings->instanceOfficesEnabled(),
			self::KIND_TALK => $this->isConversationParticipant($user, $office->getAudienceId()),
			default => false,
		};
	}

	/** @throws ApiException when Talk is not available */
	public function isConversationParticipant(IUser $user, string $token): bool {
		if (!$this->conversations->isAvailable()) {
			throw new ApiException('AUDIENCE_UNAVAILABLE', Http::STATUS_SERVICE_UNAVAILABLE);
		}
		return $this->conversations->isParticipant($user, $token);
	}

	/** @throws ApiException */
	public function isTeamMember(IUser $user, string $teamId): bool {
		if (!$this->teamManager->hasTeamSupport()) {
			throw new ApiException('AUDIENCE_UNAVAILABLE', Http::STATUS_SERVICE_UNAVAILABLE);
		}
		foreach ($this->teamsOf($user) as $team) {
			if ($team->getId() === $teamId) {
				return true;
			}
		}
		return false;
	}

	/**
	 * Audience keys of all offices the user may belong to, for directory queries.
	 * A failing Team backend hides Team offices instead of failing the directory.
	 *
	 * @return list<string>
	 */
	public function audienceKeysFor(IUser $user): array {
		if (!$this->isUsable($user)) {
			return [];
		}
		$keys = [];
		try {
			foreach ($this->teamsOf($user) as $team) {
				$keys[] = self::audienceKey(self::KIND_TEAM, $team->getId());
			}
		} catch (ApiException) {
		}
		foreach ($this->groupManager->getUserGroupIds($user) as $gid) {
			$keys[] = self::audienceKey(self::KIND_GROUP, (string)$gid);
		}
		if ($this->settings->instanceOfficesEnabled()) {
			$keys[] = self::audienceKey(self::KIND_INSTANCE, self::INSTANCE_ID);
		}
		return $keys;
	}

	/** Milliseconds timestamp until which the user is removed from the office, or null. */
	public function removedUntil(Office $office, string $uid): ?int {
		$until = $office->getRemovalMap()[$uid] ?? null;
		return $until !== null && $until > $this->clock->nowMs() ? $until : null;
	}

	/**
	 * Member and not removed for now: may show on a desk, get knocks, arrival
	 * notifications and roulette pairs of this office.
	 *
	 * @throws ApiException when the audience cannot be checked
	 */
	public function isWelcome(IUser $user, Office $office): bool {
		return $this->removedUntil($office, $user->getUID()) === null && $this->isMember($user, $office);
	}

	public function isManager(IUser $user, Office $office): bool {
		return in_array($user->getUID(), $office->getManagerList(), true) && $this->isMember($user, $office);
	}

	/** Admins manage every office. Managers must still belong to the audience. */
	public function canManage(IUser $user, Office $office): bool {
		if (!$this->isUsable($user)) {
			return false;
		}
		return $this->isAdmin($user) || $this->isManager($user, $office);
	}

	/**
	 * May see the office definition. Non-members get the same answer as for a
	 * missing office.
	 *
	 * @throws ApiException
	 */
	public function assertVisible(IUser $user, Office $office): void {
		// Managing is checked first so admins keep access when an optional backend (Teams, Talk) is down.
		if ($this->canManage($user, $office)) {
			return;
		}
		if (!$this->isMember($user, $office)) {
			throw ApiException::unavailable();
		}
	}

	/** @throws ApiException */
	public function assertCanEnter(IUser $user, Office $office): void {
		if (!$this->isMember($user, $office)) {
			throw ApiException::unavailable();
		}
		$until = $this->removedUntil($office, $user->getUID());
		if ($until !== null) {
			throw new ApiException('OFFICE_REMOVED', Http::STATUS_FORBIDDEN, 'Removed from this office for now', ['until' => $until]);
		}
	}

	/** @throws ApiException */
	public function assertCanManage(IUser $user, Office $office): void {
		$this->assertVisible($user, $office);
		if (!$this->canManage($user, $office)) {
			throw ApiException::denied();
		}
	}
}
