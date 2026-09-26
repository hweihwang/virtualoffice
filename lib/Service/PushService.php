<?php

declare(strict_types=1);

/**
 * SPDX-FileCopyrightText: 2026 Hoang Pham
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

namespace OCA\VirtualOffice\Service;

use OCP\App\IAppManager;
use OCP\IAppConfig;
use OCP\Server;
use Psr\Log\LoggerInterface;

/**
 * Sends room events through Client Push (notify_push) when it is installed.
 * Without it, clients poll; nothing here is required for correctness.
 */
class PushService {
	public const MESSAGE = 'virtualoffice_room';
	/** Knocks and their answers, sent only to the one person concerned. */
	public const KNOCK_MESSAGE = 'virtualoffice_knock';
	/** The developer docs of notify_push 1.4.1 name OCA\NotifyPush\IQueue; the code uses this. */
	private const QUEUE = 'OCA\NotifyPush\Queue\IQueue';
	/** Returned when notify_push has no Redis; it drops every message. */
	private const NULL_QUEUE = 'OCA\NotifyPush\Queue\NullQueue';

	private ?object $queue = null;
	private ?bool $available = null;

	public function __construct(
		private IAppManager $appManager,
		private IAppConfig $appConfig,
		private LoggerInterface $logger,
	) {
	}

	public function isAvailable(): bool {
		if ($this->available === null) {
			$this->available = false;
			if ($this->appManager->isEnabledForAnyone('notify_push')
				&& interface_exists(self::QUEUE)
				&& $this->appConfig->getValueString('notify_push', 'base_endpoint', '') !== '') {
				try {
					/** @psalm-suppress UndefinedClass */
					$queue = Server::get(self::QUEUE);
					if (!is_a($queue, self::NULL_QUEUE)) {
						$this->queue = $queue;
						$this->available = true;
					}
				} catch (\Throwable $e) {
					$this->logger->info('Client Push is installed but its queue is not available', ['exception' => $e]);
				}
			}
		}
		return $this->available;
	}

	/** @param list<string> $uids */
	public function push(array $uids, array $body, string $message = self::MESSAGE): void {
		if ($uids === [] || !$this->isAvailable()) {
			return;
		}
		foreach (array_unique($uids) as $uid) {
			try {
				/** @psalm-suppress UndefinedMethod */
				$this->queue->push('notify_custom', [
					'user' => $uid,
					'message' => $message,
					'body' => $body,
				]);
			} catch (\Throwable $e) {
				$this->logger->debug('Could not push a room event', ['exception' => $e]);
				return;
			}
		}
	}
}
