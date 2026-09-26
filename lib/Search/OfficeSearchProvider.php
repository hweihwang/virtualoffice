<?php

declare(strict_types=1);

/**
 * SPDX-FileCopyrightText: 2026 Hoang Pham
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

namespace OCA\VirtualOffice\Search;

use OCA\VirtualOffice\AppInfo\Application;
use OCA\VirtualOffice\Service\AccessPolicy;
use OCA\VirtualOffice\Service\OfficeService;
use OCP\IL10N;
use OCP\IURLGenerator;
use OCP\IUser;
use OCP\Search\IProvider;
use OCP\Search\ISearchQuery;
use OCP\Search\SearchResult;
use OCP\Search\SearchResultEntry;

/** Unified Search and Smart Picker results; only offices the searcher belongs to. */
class OfficeSearchProvider implements IProvider {
	public function __construct(
		private OfficeService $offices,
		private AccessPolicy $accessPolicy,
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
	public function getOrder(string $route, array $routeParameters): ?int {
		return str_starts_with($route, Application::APP_ID . '.') ? -1 : 60;
	}

	#[\Override]
	public function search(IUser $user, ISearchQuery $query): SearchResult {
		$limit = max(1, min(25, $query->getLimit()));
		$offset = (int)($query->getCursor() ?? 0);
		$entries = [];
		foreach ($this->offices->listFor($user, $query->getTerm(), $limit, $offset) as $office) {
			if (!$this->accessPolicy->isMember($user, $office)) {
				continue;
			}
			$entries[] = new SearchResultEntry(
				$this->urlGenerator->getAbsoluteURL($this->urlGenerator->imagePath(Application::APP_ID, 'app-dark.svg')),
				$office->getTitle(),
				$this->offices->audienceLabel($user, $office),
				$this->urlGenerator->linkToRouteAbsolute('virtualoffice.page.office', ['token' => $office->getToken()]),
				'',
				false,
			);
		}
		return SearchResult::paginated($this->getName(), $entries, $offset + $limit);
	}
}
