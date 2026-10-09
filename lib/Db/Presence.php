<?php

declare(strict_types=1);

/**
 * SPDX-FileCopyrightText: 2026 Hoang Pham
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

namespace OCA\VirtualOffice\Db;

use OCP\AppFramework\Db\Entity;

/**
 * Current, short-lived presence of one user. Deleted when they leave or the
 * lease runs out; no history is kept.
 *
 * @method int getOfficeId()
 * @method void setOfficeId(int $id)
 * @method int getSlot()
 * @method void setSlot(int $slot)
 * @method string getUid()
 * @method void setUid(string $uid)
 * @method string getUidKey()
 * @method void setUidKey(string $key)
 * @method string getSession()
 * @method void setSession(string $session)
 * @method int getGeneration()
 * @method void setGeneration(int $generation)
 * @method string getName()
 * @method void setName(string $name)
 * @method string getAppearance()
 * @method void setAppearance(string $appearance)
 * @method string getMode()
 * @method void setMode(string $mode)
 * @method string getTrajectory()
 * @method void setTrajectory(string $trajectory)
 * @method string|null getEmote()
 * @method void setEmote(?string $emote)
 * @method int getLeaseUntil()
 * @method void setLeaseUntil(int $time)
 * @method int getAuthorizedUntil()
 * @method void setAuthorizedUntil(int $time)
 * @method int getEnteredAt()
 * @method void setEnteredAt(int $time)
 * @method string|null getNote()
 * @method void setNote(?string $note)
 * @method string|null getBirthday()
 * @method void setBirthday(?string $monthDay)
 * @method bool getVoice()
 * @method void setVoice(bool $voice)
 */
class Presence extends Entity {
	protected int $officeId = 0;
	protected int $slot = 0;
	protected string $uid = '';
	protected string $uidKey = '';
	protected string $session = '';
	protected int $generation = 1;
	protected string $name = '';
	protected string $appearance = '{}';
	protected string $mode = 'available';
	protected string $trajectory = '{}';
	protected ?string $emote = null;
	protected int $leaseUntil = 0;
	protected int $authorizedUntil = 0;
	protected int $enteredAt = 0;
	protected ?string $note = null;
	/** "MM-DD" when the person shares their birth date. */
	protected ?string $birthday = null;
	/** Voice is on: the tab may exchange WebRTC signals with others nearby. */
	protected bool $voice = false;

	public function __construct() {
		$this->addType('officeId', 'integer');
		$this->addType('slot', 'integer');
		$this->addType('generation', 'integer');
		$this->addType('leaseUntil', 'integer');
		$this->addType('authorizedUntil', 'integer');
		$this->addType('enteredAt', 'integer');
		$this->addType('voice', 'boolean');
	}

	/** Insert every column, including values equal to the property defaults. */
	public function markAllFieldsUpdated(): void {
		foreach (array_keys(get_object_vars($this)) as $field) {
			if ($field !== 'id' && !str_starts_with($field, '_')) {
				$this->markFieldUpdated($field);
			}
		}
	}

	/** @return array{id: int, points: list<array{0: float|int, 1: float|int}>, arriveAt: list<int>} */
	public function getTrajectoryData(): array {
		/** @var array{id: int, points: list<array{0: float|int, 1: float|int}>, arriveAt: list<int>} */
		return json_decode($this->trajectory, true);
	}

	/** @return array{id: string, startedAt: int, endsAt: int}|null */
	public function getEmoteData(int $now): ?array {
		if ($this->emote === null) {
			return null;
		}
		$emote = json_decode($this->emote, true);
		return is_array($emote) && ($emote['endsAt'] ?? 0) > $now ? $emote : null;
	}

	/** The "Today" note while it has not expired. */
	public function getNoteText(int $now): ?string {
		$note = $this->note === null ? null : json_decode($this->note, true);
		return is_array($note) && is_string($note['text'] ?? null) && ($note['expiresAt'] ?? 0) > $now ? $note['text'] : null;
	}
}
