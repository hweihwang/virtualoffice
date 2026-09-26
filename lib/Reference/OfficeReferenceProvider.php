<?php

declare(strict_types=1);

/**
 * SPDX-FileCopyrightText: 2026 Hoang Pham
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

namespace OCA\VirtualOffice\Reference;

use OCA\VirtualOffice\AppInfo\Application;
use OCP\Collaboration\Reference\ADiscoverableReferenceProvider;
use OCP\Collaboration\Reference\IReference;
use OCP\Collaboration\Reference\ISearchableReferenceProvider;
use OCP\Collaboration\Reference\Reference;
use OCP\IL10N;
use OCP\IURLGenerator;

/**
 * Resolved references are cached by core for an hour and shared between
 * viewers, so they only carry generic data. The widget fetches the office
 * name and people count through the authorized card endpoint.
 */
class OfficeReferenceProvider extends ADiscoverableReferenceProvider implements ISearchableReferenceProvider {
	public const RICH_OBJECT_TYPE = 'virtualoffice_office';

	public function __construct(
		private IURLGenerator $urlGenerator,
		private IL10N $l10n,
	) {
	}

	#[\Override]
	public function getId(): string {
		return Application::APP_ID;
	}

	#[\Override]
	public function getTitle(): string {
		return $this->l10n->t('Virtual Office');
	}

	#[\Override]
	public function getOrder(): int {
		return 60;
	}

	#[\Override]
	public function getIconUrl(): string {
		return $this->urlGenerator->getAbsoluteURL($this->urlGenerator->imagePath(Application::APP_ID, 'app-dark.svg'));
	}

	#[\Override]
	public function getSupportedSearchProviderIds(): array {
		return [Application::APP_ID];
	}

	#[\Override]
	public function matchReference(string $referenceText): bool {
		return $this->tokenFrom($referenceText) !== null;
	}

	#[\Override]
	public function resolveReference(string $referenceText): ?IReference {
		$token = $this->tokenFrom($referenceText);
		if ($token === null) {
			return null;
		}
		$url = $this->urlGenerator->linkToRouteAbsolute('virtualoffice.page.office', ['token' => $token]);
		$reference = new Reference($referenceText);
		$reference->setTitle($this->l10n->t('Virtual Office'));
		$reference->setDescription($this->l10n->t('Step in to see who is around'));
		$reference->setImageUrl($this->urlGenerator->getAbsoluteURL($this->urlGenerator->imagePath(Application::APP_ID, 'office-preview.webp')));
		$reference->setUrl($url);
		$reference->setRichObject(self::RICH_OBJECT_TYPE, ['token' => $token, 'url' => $url]);
		return $reference;
	}

	#[\Override]
	public function getCachePrefix(string $referenceId): string {
		return self::RICH_OBJECT_TYPE . ':' . ($this->tokenFrom($referenceId) ?? '');
	}

	#[\Override]
	public function getCacheKey(string $referenceId): ?string {
		return null;
	}

	private function tokenFrom(string $text): ?string {
		$bases = [
			rtrim($this->urlGenerator->getAbsoluteURL('/index.php/apps/virtualoffice/o/'), '/'),
			rtrim($this->urlGenerator->getAbsoluteURL('/apps/virtualoffice/o/'), '/'),
		];
		foreach ($bases as $base) {
			if (preg_match('#^' . preg_quote($base, '#') . '/([a-f0-9]{32})/?(?:[?\#].*)?$#', trim($text), $matches) === 1) {
				return $matches[1];
			}
		}
		return null;
	}
}
