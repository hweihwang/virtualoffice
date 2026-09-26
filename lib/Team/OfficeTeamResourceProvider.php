<?php

declare(strict_types=1);

/**
 * SPDX-FileCopyrightText: 2026 Hoang Pham
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

namespace OCA\VirtualOffice\Team;

use OCA\VirtualOffice\AppInfo\Application;
use OCA\VirtualOffice\Db\OfficeMapper;
use OCA\VirtualOffice\Exception\ApiException;
use OCA\VirtualOffice\Service\AccessPolicy;
use OCP\AppFramework\Db\DoesNotExistException;
use OCP\IL10N;
use OCP\IURLGenerator;
use OCP\IUserSession;
use OCP\Teams\ITeamResourceProvider;
use OCP\Teams\TeamResource;

/** Lists a Team's offices on the Team page, only for signed-in Team members. */
class OfficeTeamResourceProvider implements ITeamResourceProvider {
	public function __construct(
		private OfficeMapper $mapper,
		private AccessPolicy $accessPolicy,
		private IUserSession $userSession,
		private IURLGenerator $urlGenerator,
		private IL10N $l10n,
	) {
	}

	#[\Override]
	public function getId(): string {
		return Application::APP_ID;
	}

	#[\Override]
	public function getName(): string {
		return $this->l10n->t('Virtual offices');
	}

	#[\Override]
	public function getIconSvg(): string {
		// Drawn in the text colour, so it fits light and dark themes.
		return str_replace('#000', 'currentColor', (string)file_get_contents(__DIR__ . '/../../img/app-dark.svg'));
	}

	#[\Override]
	public function getSharedWith(string $teamId): array {
		$user = $this->userSession->getUser();
		try {
			if ($user === null || !$this->accessPolicy->isUsable($user) || !$this->accessPolicy->isTeamMember($user, $teamId)) {
				return [];
			}
		} catch (ApiException) {
			return [];
		}
		$key = AccessPolicy::audienceKey(AccessPolicy::KIND_TEAM, $teamId);
		return array_map(fn ($office) => new TeamResource(
			$this,
			$office->getToken(),
			$office->getTitle(),
			$this->urlGenerator->linkToRouteAbsolute('virtualoffice.page.office', ['token' => $office->getToken()]),
			iconSvg: $this->getIconSvg(),
		), $this->mapper->findByAudienceKeys([$key], '', 50, 0));
	}

	#[\Override]
	public function isSharedWithTeam(string $teamId, string $resourceId): bool {
		return $this->getTeamsForResource($resourceId) === [$teamId];
	}

	#[\Override]
	public function getTeamsForResource(string $resourceId): array {
		try {
			$office = $this->mapper->findByToken($resourceId);
		} catch (DoesNotExistException) {
			return [];
		}
		return $office->getAudienceKind() === AccessPolicy::KIND_TEAM ? [$office->getAudienceId()] : [];
	}
}
