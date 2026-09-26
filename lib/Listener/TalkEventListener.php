<?php

declare(strict_types=1);

/**
 * SPDX-FileCopyrightText: 2026 Hoang Pham
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

namespace OCA\VirtualOffice\Listener;

use OCA\VirtualOffice\Db\OfficeMapper;
use OCA\VirtualOffice\Service\AccessPolicy;
use OCA\VirtualOffice\Service\Clock;
use OCA\VirtualOffice\Service\RoomService;
use OCP\EventDispatcher\Event;
use OCP\EventDispatcher\IEventListener;
use Psr\Log\LoggerInterface;

/**
 * Follows Talk conversations through Talk's documented PHP events
 * (https://nextcloud-talk.readthedocs.io/en/latest/events/). Talk may be
 * missing, so its classes are only referenced by name.
 *
 * - deleted conversation: its office is deleted
 * - renamed conversation: its office is renamed
 * - removed participant: they leave the conversation's office at once
 * - calls: offices show whether a call runs and who is in it
 *
 * @template-implements IEventListener<Event>
 * @psalm-suppress UndefinedClass, UndefinedMethod, TypeDoesNotContainType, MixedMethodCall, MixedAssignment, MixedArgument
 */
class TalkEventListener implements IEventListener {
	public const EVENTS = [
		'OCA\Talk\Events\RoomDeletedEvent',
		'OCA\Talk\Events\RoomModifiedEvent',
		'OCA\Talk\Events\AttendeesRemovedEvent',
		'OCA\Talk\Events\AttendeeRemovedEvent',
		'OCA\Talk\Events\CallStartedEvent',
		'OCA\Talk\Events\CallEndedEvent',
		'OCA\Talk\Events\CallEndedForEveryoneEvent',
		'OCA\Talk\Events\ParticipantModifiedEvent',
		'OCA\Talk\Events\SessionLeftRoomEvent',
	];

	public function __construct(
		private OfficeMapper $offices,
		private RoomService $room,
		private Clock $clock,
		private LoggerInterface $logger,
	) {
	}

	#[\Override]
	public function handle(Event $event): void {
		try {
			$this->dispatch($event);
		} catch (\Throwable $e) {
			// Never break Talk because of the office.
			$this->logger->warning('Could not follow a Talk event', ['exception' => $e]);
		}
	}

	private function dispatch(Event $event): void {
		$class = get_class($event);
		$token = (string)$event->getRoom()->getToken();
		switch ($class) {
			case 'OCA\Talk\Events\RoomDeletedEvent':
				foreach ($this->offices->findByTalkToken($token) as $office) {
					if ($office->getAudienceKind() === AccessPolicy::KIND_TALK) {
						$this->room->deleteOffice($office, null);
					}
				}
				$this->room->updateCall($token, static fn (array $call) => ['active' => false, 'since' => null, 'participants' => []]);
				return;
			case 'OCA\Talk\Events\RoomModifiedEvent':
				if ($event->getProperty() === 'name' && is_string($event->getNewValue()) && trim($event->getNewValue()) !== '') {
					$this->rename($token, mb_substr(trim($event->getNewValue()), 0, 120));
				}
				return;
			case 'OCA\Talk\Events\AttendeesRemovedEvent':
				foreach ($event->getAttendees() as $attendee) {
					$this->removed($token, $attendee);
				}
				return;
			case 'OCA\Talk\Events\AttendeeRemovedEvent':
				$this->removed($token, $event->getAttendee());
				return;
			case 'OCA\Talk\Events\CallStartedEvent':
				$now = $this->clock->nowMs();
				$this->room->updateCall($token, static fn (array $call) => ['active' => true, 'since' => $call['active'] ? $call['since'] : $now, 'participants' => $call['participants']]);
				return;
			case 'OCA\Talk\Events\CallEndedEvent':
			case 'OCA\Talk\Events\CallEndedForEveryoneEvent':
				$this->room->updateCall($token, static fn (array $call) => ['active' => false, 'since' => null, 'participants' => []]);
				return;
			case 'OCA\Talk\Events\ParticipantModifiedEvent':
				if ($event->getProperty() === 'inCall') {
					$this->inCall($token, $event->getParticipant(), (int)$event->getNewValue() !== 0);
				}
				return;
			case 'OCA\Talk\Events\SessionLeftRoomEvent':
				if (!$event->isRejoining()) {
					$this->inCall($token, $event->getParticipant(), false);
				}
				return;
		}
	}

	private function rename(string $token, string $name): void {
		$now = $this->clock->nowMs();
		$this->offices->renameByTalkToken($token, $name, $now);
		foreach ($this->offices->findByTalkToken($token) as $office) {
			$config = $office->getConfigData();
			if ($config['talk'] !== null && in_array($config['talk']['source'], ['conversation', 'team'], true)) {
				$config['talk']['label'] = $name;
				$office->setConfig(json_encode($config, JSON_THROW_ON_ERROR));
				$this->offices->updateIfRevision($office, $office->getConfigRev());
				$this->room->announceConfig($office);
			}
		}
	}

	private function removed(string $token, object $attendee): void {
		if ($attendee->getActorType() !== 'users') {
			return;
		}
		$uid = (string)$attendee->getActorId();
		foreach ($this->offices->findByTalkToken($token) as $office) {
			if ($office->getAudienceKind() === AccessPolicy::KIND_TALK) {
				$this->room->evict($uid, $office->getId(), 'access');
			}
		}
		$this->inCallUid($token, $uid, false);
	}

	private function inCall(string $token, object $participant, bool $inCall): void {
		$attendee = $participant->getAttendee();
		if ($attendee->getActorType() === 'users') {
			$this->inCallUid($token, (string)$attendee->getActorId(), $inCall);
		}
	}

	private function inCallUid(string $token, string $uid, bool $inCall): void {
		$now = $this->clock->nowMs();
		$this->room->updateCall($token, static function (array $call) use ($uid, $inCall, $now) {
			$participants = array_values(array_diff($call['participants'], [$uid]));
			if ($inCall) {
				$participants[] = $uid;
			}
			$active = $call['active'] || $inCall;
			return ['active' => $active, 'since' => $active ? ($call['since'] ?? $now) : null, 'participants' => $participants];
		});
	}
}
