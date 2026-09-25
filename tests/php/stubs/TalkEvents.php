<?php

declare(strict_types=1);

/**
 * SPDX-FileCopyrightText: 2026 Hoang Pham
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

// Minimal stand-ins for the Talk events the app listens to, with the getters documented by Talk.

namespace OCA\Talk\Events;

use OCP\EventDispatcher\Event;

class StubRoom {
	public function __construct(
		private string $token,
	) {
	}

	public function getToken(): string {
		return $this->token;
	}
}

class StubAttendee {
	public function __construct(
		private string $type,
		private string $id,
	) {
	}

	public function getActorType(): string {
		return $this->type;
	}

	public function getActorId(): string {
		return $this->id;
	}
}

class StubParticipant {
	public function __construct(
		private StubAttendee $attendee,
	) {
	}

	public function getAttendee(): StubAttendee {
		return $this->attendee;
	}
}

abstract class StubRoomEvent extends Event {
	public function __construct(
		private string $token,
	) {
		parent::__construct();
	}

	public function getRoom(): StubRoom {
		return new StubRoom($this->token);
	}
}

class RoomDeletedEvent extends StubRoomEvent {
}

class CallStartedEvent extends StubRoomEvent {
}

class CallEndedEvent extends StubRoomEvent {
}

class RoomModifiedEvent extends StubRoomEvent {
	public function __construct(
		string $token,
		private string $property,
		private mixed $newValue,
	) {
		parent::__construct($token);
	}

	public function getProperty(): string {
		return $this->property;
	}

	public function getNewValue(): mixed {
		return $this->newValue;
	}
}

class AttendeesRemovedEvent extends StubRoomEvent {
	/** @param list<StubAttendee> $attendees */
	public function __construct(
		string $token,
		private array $attendees,
	) {
		parent::__construct($token);
	}

	public function getAttendees(): array {
		return $this->attendees;
	}
}

class ParticipantModifiedEvent extends StubRoomEvent {
	public function __construct(
		string $token,
		private StubParticipant $participant,
		private string $property,
		private int $newValue,
	) {
		parent::__construct($token);
	}

	public function getParticipant(): StubParticipant {
		return $this->participant;
	}

	public function getProperty(): string {
		return $this->property;
	}

	public function getNewValue(): int {
		return $this->newValue;
	}
}
