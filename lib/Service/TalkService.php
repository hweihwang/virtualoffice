<?php

declare(strict_types=1);

/**
 * SPDX-FileCopyrightText: 2026 Hoang Pham
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

namespace OCA\VirtualOffice\Service;

use OCA\VirtualOffice\Db\Office;
use OCA\VirtualOffice\Exception\ApiException;
use OCP\IL10N;
use OCP\IURLGenerator;
use OCP\IUser;
use OCP\Talk\IBroker;
use OCP\Teams\ITeamManager;
use OCP\Teams\TeamResource;
use Psr\Log\LoggerInterface;

/**
 * The office links to at most one Talk conversation. Talk still decides who
 * may read it; the link never widens access in either direction.
 */
class TalkService {
	private const TOKEN_PATTERN = '/^[a-z0-9]{4,32}$/';

	public function __construct(
		private IBroker $broker,
		private ITeamManager $teamManager,
		private IURLGenerator $urlGenerator,
		private LoggerInterface $logger,
		private IL10N $l10n,
	) {
	}

	public function isAvailableForUser(): bool {
		try {
			return $this->broker->hasBackend() && $this->broker->isEnabledForUser();
		} catch (\Throwable) {
			return false;
		}
	}

	/** @return list<array{token: string, label: string}> conversations shared with the office's Team */
	public function teamConversations(IUser $user, Office $office): array {
		if ($office->getAudienceKind() !== AccessPolicy::KIND_TEAM || !$this->isAvailableForUser()) {
			return [];
		}
		try {
			$resources = $this->teamManager->getSharedWith($office->getAudienceId(), $user->getUID());
		} catch (\Throwable $e) {
			$this->logger->warning('Could not list Team resources', ['exception' => $e]);
			return [];
		}
		$result = [];
		foreach ($resources as $resource) {
			if ($resource instanceof TeamResource && $resource->getProvider()->getId() === 'talk') {
				$result[] = ['token' => $resource->getId(), 'label' => $resource->getLabel()];
			}
		}
		return $result;
	}

	/**
	 * Validates a Talk binding from a manager's request.
	 *
	 * @return array{source: string, token: string, label: string}|null
	 * @throws ApiException
	 */
	public function validateBinding(IUser $user, Office $office, mixed $talk): ?array {
		if ($talk === null) {
			return null;
		}
		if (!is_array($talk) || array_diff(array_keys($talk), ['source', 'token', 'url', 'label']) !== []) {
			throw ApiException::invalid($this->l10n->t('Paste a Talk conversation link from this Nextcloud'));
		}
		$source = $talk['source'] ?? null;
		if ($source === 'team') {
			$token = $talk['token'] ?? null;
			foreach ($this->teamConversations($user, $office) as $conversation) {
				if ($conversation['token'] === $token) {
					return ['source' => 'team', 'token' => $conversation['token'], 'label' => $conversation['label']];
				}
			}
			throw ApiException::invalid($this->l10n->t('This conversation is not shared with the Team'));
		}
		if ($source === 'link') {
			$token = $this->parseConversationToken((string)($talk['url'] ?? $talk['token'] ?? ''));
			$label = trim(preg_replace('/[\x00-\x1F\x7F]/u', '', (string)($talk['label'] ?? '')) ?? '');
			if ($token === null) {
				throw ApiException::invalid($this->l10n->t('Paste a Talk conversation link from this Nextcloud'));
			}
			if ($label === '' || mb_strlen($label) > 60) {
				throw ApiException::invalid($this->l10n->t('Give the conversation a name of up to 60 characters'));
			}
			return ['source' => 'link', 'token' => $token, 'label' => $label];
		}
		throw ApiException::invalid($this->l10n->t('Paste a Talk conversation link from this Nextcloud'));
	}

	/** Accepts a bare token or a conversation URL on this instance. */
	public function parseConversationToken(string $input): ?string {
		$input = trim($input);
		if (preg_match(self::TOKEN_PATTERN, $input) === 1) {
			return $input;
		}
		$base = rtrim($this->urlGenerator->getAbsoluteURL('/'), '/');
		if (!str_starts_with($input, $base . '/')) {
			return null;
		}
		$path = (string)parse_url($input, PHP_URL_PATH);
		if (preg_match('#/call/([a-z0-9]{4,32})/?$#', $path, $matches) === 1) {
			return $matches[1];
		}
		return null;
	}

	/**
	 * URL to open the office's conversation, or null when the link no longer works.
	 */
	public function conversationUrl(IUser $user, Office $office): ?string {
		$talk = $office->getConfigData()['talk'];
		if ($talk === null || !$this->isAvailableForUser()) {
			return null;
		}
		if ($talk['source'] === 'team') {
			$stillShared = array_filter($this->teamConversations($user, $office), static fn (array $c) => $c['token'] === $talk['token']);
			if ($stillShared === []) {
				return null;
			}
		}
		return $this->urlGenerator->linkToRouteAbsolute('spreed.Page.showCall', ['token' => $talk['token']]);
	}
}
