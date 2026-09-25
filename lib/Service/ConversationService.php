<?php

declare(strict_types=1);

/**
 * SPDX-FileCopyrightText: 2026 Hoang Pham
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

namespace OCA\VirtualOffice\Service;

use OCP\Collaboration\Resources\IManager as IResourceManager;
use OCP\Collaboration\Resources\IProviderManager;
use OCP\Collaboration\Resources\ResourceException;
use OCP\IUser;
use OCP\Talk\IBroker;
use Psr\Log\LoggerInterface;

/**
 * Talk conversations as office audiences, through public Server APIs only.
 *
 * Talk registers a Collaboration resource provider of type "room" whose
 * canAccessResource() is true for real participants of a conversation
 * (added directly, through a group or a Team; not people who only joined a
 * public conversation). The provider is called directly: Server's access
 * cache is only invalidated for rooms that are part of a collection, so it
 * could keep a removed participant's access.
 */
class ConversationService {
	public const TOKEN_PATTERN = '/^[a-z0-9]{4,32}$/';

	public function __construct(
		private IProviderManager $providers,
		private IResourceManager $resources,
		private IBroker $broker,
		private LoggerInterface $logger,
	) {
	}

	public function isAvailable(): bool {
		try {
			return $this->broker->hasBackend();
		} catch (\Throwable) {
			return false;
		}
	}

	public static function isToken(mixed $token): bool {
		return is_string($token) && preg_match(self::TOKEN_PATTERN, $token) === 1;
	}

	public function isParticipant(IUser $user, string $token): bool {
		if (!self::isToken($token)) {
			return false;
		}
		$resource = $this->resources->createResource('room', $token);
		foreach ($this->providers->getResourceProviders() as $provider) {
			if ($provider->getType() !== 'room') {
				continue;
			}
			try {
				if ($provider->canAccessResource($resource, $user)) {
					return true;
				}
			} catch (ResourceException) {
			} catch (\Throwable $e) {
				$this->logger->warning('Could not check Talk conversation access', ['exception' => $e]);
			}
		}
		return false;
	}

	/**
	 * Name and type of a conversation as the signed-in user sees it.
	 *
	 * @return array{name: string, type: string}|null type is one2one, group or public
	 */
	public function details(string $token): ?array {
		if (!self::isToken($token)) {
			return null;
		}
		$resource = $this->resources->createResource('room', $token);
		foreach ($this->providers->getResourceProviders() as $provider) {
			if ($provider->getType() !== 'room') {
				continue;
			}
			try {
				$data = $provider->getResourceRichObject($resource);
				return ['name' => (string)($data['name'] ?? ''), 'type' => (string)($data['call-type'] ?? '')];
			} catch (\Throwable) {
			}
		}
		return null;
	}
}
