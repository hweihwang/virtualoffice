<?php

declare(strict_types=1);

/**
 * SPDX-FileCopyrightText: 2026 Hoang Pham
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

namespace OCA\VirtualOffice\Service;

use OCA\VirtualOffice\Db\DeskMapper;
use OCA\VirtualOffice\Db\Office;
use OCA\VirtualOffice\Db\OfficeMapper;
use OCA\VirtualOffice\Db\Presence;
use OCA\VirtualOffice\Db\PresenceMapper;
use OCA\VirtualOffice\Db\RouletteMapper;
use OCA\VirtualOffice\Exception\ApiException;
use OCP\AppFramework\Db\DoesNotExistException;
use OCP\AppFramework\Db\TTransactional;
use OCP\AppFramework\Http;
use OCP\DB\Exception as DBException;
use OCP\IDBConnection;
use OCP\IUser;
use OCP\IUserManager;
use OCP\Teams\ITeamManager;

/**
 * Live room state. Each change runs in a transaction that first takes the
 * office row's write lock (by bumping its presence revision), so capacity,
 * ownership and movement are decided one at a time per office.
 *
 * Events are pushed after commit to people currently in the room. Clients
 * that do not get pushes poll snapshot(), which only returns data when the
 * revision changed.
 */
class RoomService {
	use TTransactional;

	public const LEASE_MS = 90_000;
	public const RENEW_WHEN_BELOW_MS = 75_000;
	public const AUTHORIZATION_MS = 20_000;
	public const EMOTE_COOLDOWN_MS = 1_000;
	public const FOCUS_MINUTES = [25, 50];
	private const SESSION_PATTERN = '/^[a-f0-9]{32}$/';

	/** @var array<int, array{token: string, events: list<array>, extra: list<string>}> */
	private array $pending = [];
	/** @var array<string, bool> */
	private array $sharedWithTeam = [];
	/** Whether the last enter brought someone new into the office. */
	private bool $arrived = false;

	public function __construct(
		private IDBConnection $db,
		private OfficeMapper $officeMapper,
		private PresenceMapper $presenceMapper,
		private DeskMapper $deskMapper,
		private RouletteMapper $rouletteMapper,
		private AccessPolicy $accessPolicy,
		private Catalog $catalog,
		private Movement $movement,
		private PreferenceService $preferences,
		private PushService $push,
		private Settings $settings,
		private WatchService $watches,
		private BirthdayService $birthdays,
		private IUserManager $userManager,
		private ITeamManager $teamManager,
		private Clock $clock,
	) {
	}

	public function enter(IUser $user, Office $office, string $session, bool $takeover): array {
		$this->assertSession($session);
		$this->accessPolicy->assertCanEnter($user, $office);
		$this->revalidate($office, $user->getUID());
		$uidKey = self::uidKey($user->getUID());
		for ($attempt = 0; ; $attempt++) {
			$existing = $this->presenceMapper->findByUidKey($uidKey);
			$officeIds = [$office->getId()];
			if ($existing !== null && $existing->getOfficeId() !== $office->getId()) {
				$officeIds[] = $existing->getOfficeId();
			}
			try {
				$this->arrived = false;
				$result = $this->mutate($officeIds, function (array $locked) use ($user, $office, $session, $takeover, $uidKey, $existing) {
					$fresh = $this->presenceMapper->findByUidKey($uidKey);
					if ($fresh?->getOfficeId() !== $existing?->getOfficeId()) {
						throw new RetryException();
					}
					return $this->doEnter($user, $locked[$office->getId()], $fresh, $session, $takeover);
				});
				if ($this->takeArrived()) {
					$this->watches->arrived($office, $user);
				}
				return $result;
			} catch (RetryException) {
			} catch (DBException $e) {
				if ($e->getReason() !== DBException::REASON_UNIQUE_CONSTRAINT_VIOLATION) {
					throw $e;
				}
			}
			if ($attempt >= 2) {
				throw new ApiException('CONFLICT', Http::STATUS_CONFLICT, 'Please try again');
			}
		}
	}

	private function takeArrived(): bool {
		$arrived = $this->arrived;
		$this->arrived = false;
		return $arrived;
	}

	private function doEnter(IUser $user, Office $office, ?Presence $row, string $session, bool $takeover): \Closure {
		$now = $this->clock->nowMs();
		$this->removeExpired($office, $now);

		if ($row !== null && $row->getOfficeId() !== $office->getId()) {
			if ($row->getLeaseUntil() >= $now && !$takeover) {
				throw new ApiException('ACTIVE_ELSEWHERE', Http::STATUS_CONFLICT, 'You are in another office', ['sameOffice' => false]);
			}
			$other = $this->officeMapper->findById($row->getOfficeId());
			$this->removePresence($other, $row, 'moved');
			$row = null;
		}

		$profile = $this->profile($user);
		if ($row !== null) {
			if ($row->getSession() !== $session) {
				if ($row->getLeaseUntil() >= $now && !$takeover) {
					throw new ApiException('ACTIVE_ELSEWHERE', Http::STATUS_CONFLICT, 'You are already here in another window', ['sameOffice' => true]);
				}
				$row->setSession($session);
				$row->setGeneration($row->getGeneration() + 1);
				$row->setEnteredAt($now);
				$row->setEmote(null);
				$row->setTrajectory($this->encode($this->movement->stop($row->getTrajectoryData(), $now)));
			}
			$row->setName($profile['name']);
			$row->setAppearance($this->encode($profile['appearance']));
			$row->setNote($profile['note']);
			$row->setBirthday($profile['birthday']);
			$row->setLeaseUntil($now + self::LEASE_MS);
			$row->setAuthorizedUntil($now + self::AUTHORIZATION_MS);
			$this->presenceMapper->update($row);
		} else {
			$rows = $this->presenceMapper->findByOffice($office->getId());
			$capacity = $this->settings->roomCapacity();
			if (count($rows) >= $capacity) {
				throw new ApiException('ROOM_FULL', Http::STATUS_CONFLICT, 'This office is full', ['capacity' => $capacity]);
			}
			$used = array_map(static fn (Presence $p) => $p->getSlot(), $rows);
			$slot = 0;
			while (in_array($slot, $used, true)) {
				$slot++;
			}
			$this->arrived = true;
			$row = new Presence();
			$row->setOfficeId($office->getId());
			$row->setSlot($slot);
			$row->setUid($user->getUID());
			$row->setUidKey(self::uidKey($user->getUID()));
			$row->setSession($session);
			$row->setGeneration(1);
			$row->setName($profile['name']);
			$row->setAppearance($this->encode($profile['appearance']));
			$row->setMode('available');
			$row->setNote($profile['note']);
			$row->setBirthday($profile['birthday']);
			$row->setTrajectory($this->encode($this->movement->stationary($this->spawnCell($office, $rows, $now), $now)));
			$row->setLeaseUntil($now + self::LEASE_MS);
			$row->setAuthorizedUntil($now + self::AUTHORIZATION_MS);
			$row->setEnteredAt($now);
			$row->markAllFieldsUpdated();
			$this->presenceMapper->insert($row);
		}
		$this->queue($office, ['kind' => 'upsert', 'participant' => $this->participant($row, $now)]);
		return fn (int $rev) => $this->snapshot($office, $rev, $now) + ['you' => ['session' => $session, 'generation' => $row->getGeneration()]];
	}

	/**
	 * Heartbeat and poll. Renews the lease, re-checks access every
	 * AUTHORIZATION_MS and returns a snapshot when the revision changed.
	 */
	public function poll(IUser $user, Office $office, string $session, int $knownRev): array {
		$row = $this->requirePresence($user, $office, $session);
		$now = $this->clock->nowMs();
		if ($row->getLeaseUntil() - $now < self::RENEW_WHEN_BELOW_MS) {
			// Only requirePresence() extends the authorization, after checking access.
			$this->presenceMapper->renewLease($row->getId(), $now + self::LEASE_MS, $row->getAuthorizedUntil());
		}
		$this->revalidate($office, $user->getUID());
		if ($this->hasExpired($office, $now)) {
			$this->mutate([$office->getId()], function (array $locked) use ($now) {
				$office = reset($locked);
				$this->removeExpired($office, $now);
				return null;
			});
		}
		try {
			$office = $this->officeMapper->findById($office->getId());
		} catch (DoesNotExistException) {
			throw ApiException::unavailable();
		}
		if ($office->getPresenceRev() === $knownRev) {
			return ['changed' => false, 'rev' => $knownRev, 'serverTime' => $now];
		}
		return ['changed' => true] + $this->snapshot($office, $office->getPresenceRev(), $now)
			+ ['you' => ['session' => $session, 'generation' => $row->getGeneration()]];
	}

	/** @param mixed $path list of [x, y] cells starting ahead on the current path */
	public function move(IUser $user, Office $office, string $session, mixed $path): array {
		$layout = $this->catalog->layout($office->getLayoutId());
		if (!$this->movement->isValidPath($layout, $path)) {
			throw ApiException::invalid('Invalid path');
		}
		/** @var list<array{0: int, 1: int}> $path */
		return $this->changeOwn($user, $office, $session, function (Presence $row, int $now) use ($path) {
			$next = $this->movement->rerouteVia($row->getTrajectoryData(), $now, $path);
			if ($next === null) {
				throw new ApiException('PATH_CONFLICT', Http::STATUS_CONFLICT, 'Your character already moved on', [
					'participant' => $this->participant($row, $now),
					'serverTime' => $now,
				]);
			}
			$row->setTrajectory($this->encode($next));
			return true;
		});
	}

	public function stop(IUser $user, Office $office, string $session): array {
		return $this->changeOwn($user, $office, $session, function (Presence $row, int $now) {
			$current = $row->getTrajectoryData();
			$stopped = $this->movement->stop($current, $now);
			if ($stopped === $current) {
				return false;
			}
			$row->setTrajectory($this->encode($stopped));
			return true;
		});
	}

	public function emote(IUser $user, Office $office, string $session, mixed $emoteId): array {
		if (!is_string($emoteId) || !in_array($emoteId, $this->catalog->emoteIds(), true)) {
			throw ApiException::invalid('Unknown emote');
		}
		return $this->changeOwn($user, $office, $session, function (Presence $row, int $now) use ($emoteId) {
			$current = $row->getEmoteData($now);
			if ($current !== null && $now - $current['startedAt'] < self::EMOTE_COOLDOWN_MS) {
				throw new ApiException('RATE_LIMITED', Http::STATUS_TOO_MANY_REQUESTS, 'One reaction per second');
			}
			$row->setEmote($this->encode(['id' => $emoteId, 'startedAt' => $now, 'endsAt' => $now + $this->catalog->emoteDuration($emoteId)]));
			return true;
		});
	}

	public function setMode(IUser $user, Office $office, string $session, mixed $mode): array {
		if (!is_string($mode) || !in_array($mode, $this->catalog->modes(), true)) {
			throw ApiException::invalid('Unknown mode');
		}
		return $this->changeOwn($user, $office, $session, function (Presence $row) use ($mode) {
			if ($row->getMode() === $mode) {
				return false;
			}
			$row->setMode($mode);
			return true;
		});
	}

	/** Picks up a changed display name or appearance. */
	public function refreshProfile(IUser $user, Office $office, string $session): array {
		$profile = $this->profile($user);
		return $this->changeOwn($user, $office, $session, function (Presence $row) use ($profile) {
			$appearance = $this->encode($profile['appearance']);
			if ($row->getName() === $profile['name'] && $row->getAppearance() === $appearance) {
				return false;
			}
			$row->setName($profile['name']);
			$row->setAppearance($appearance);
			return true;
		});
	}

	public function interact(IUser $user, Office $office, string $session, mixed $propId): array {
		$layout = $this->catalog->layout($office->getLayoutId());
		$prop = is_string($propId) ? $this->catalog->prop($layout, $propId) : null;
		if ($prop === null) {
			throw ApiException::invalid('Unknown object');
		}
		$this->assertSession($session);
		$this->requirePresence($user, $office, $session);
		return $this->mutate([$office->getId()], function (array $locked) use ($user, $session, $prop) {
			$office = reset($locked);
			$row = $this->lockedPresence($user, $office, $session);
			$now = $this->clock->nowMs();
			[$x, $y] = $this->movement->positionAt($row->getTrajectoryData(), $now);
			if (hypot((float)$x - (float)$prop['cell'][0], (float)$y - (float)$prop['cell'][1]) > (float)$prop['radius'] + 1e-9) {
				throw new ApiException('OUT_OF_REACH', Http::STATUS_UNPROCESSABLE_ENTITY, 'Walk closer first');
			}
			$state = json_decode($office->getRoomState(), true);
			$props = $office->getActiveProps($now);
			if (isset($props[$prop['id']])) {
				throw new NoChangeException(['outcome' => 'already-active', 'serverTime' => $now]);
			}
			$props[$prop['id']] = ['startedAt' => $now, 'endsAt' => $now + (int)$prop['durationMs']];
			$state = (is_array($state) ? $state : []);
			$state['props'] = $props;
			$this->officeMapper->updateRoomState($office->getId(), $this->encode($state));
			$this->queue($office, ['kind' => 'prop', 'prop' => ['id' => $prop['id']] + $props[$prop['id']], 'uid' => $user->getUID()]);
			return fn (int $rev) => ['outcome' => 'started', 'rev' => $rev, 'serverTime' => $now];
		});
	}

	public function leave(IUser $user, Office $office, string $session): void {
		$row = $this->presenceMapper->findByUidKey(self::uidKey($user->getUID()));
		if ($row === null || $row->getOfficeId() !== $office->getId() || $row->getSession() !== $session) {
			return;
		}
		$this->mutate([$office->getId()], function (array $locked) use ($user, $session) {
			$office = reset($locked);
			$row = $this->presenceMapper->findByUidKey(self::uidKey($user->getUID()));
			if ($row === null || $row->getOfficeId() !== $office->getId() || $row->getSession() !== $session) {
				throw new NoChangeException(null);
			}
			$this->removePresence($office, $row, 'left');
			return null;
		});
	}

	/**
	 * Removes a user from wherever they are, optionally only from one office.
	 * Used for moderation, lost access, disabled and deleted accounts.
	 */
	public function evict(string $uid, ?int $onlyOfficeId, string $reason): void {
		$row = $this->presenceMapper->findByUidKey(self::uidKey($uid));
		if ($row === null || ($onlyOfficeId !== null && $row->getOfficeId() !== $onlyOfficeId)) {
			return;
		}
		try {
			$this->mutate([$row->getOfficeId()], function (array $locked) use ($uid, $reason, $row) {
				$office = reset($locked);
				$fresh = $this->presenceMapper->findByUidKey(self::uidKey($uid));
				if ($fresh === null || $fresh->getOfficeId() !== $row->getOfficeId()) {
					throw new NoChangeException(null);
				}
				$this->removePresence($office, $fresh, $reason, [$uid]);
				return null;
			});
		} catch (ApiException) {
		}
	}

	/**
	 * Call state of the office's conversation, or null when the office does
	 * not share its audience with the conversation (a pasted link, or a
	 * conversation no longer shared with the Team), so a call is never
	 * revealed to people outside it. "known" is false until Talk reported a
	 * call event for the conversation after the office was linked.
	 *
	 * @return array{known: bool, active: bool, since: ?int, participants: list<string>, names: array<string, string>}|null
	 */
	public function callState(Office $office): ?array {
		$call = $this->storedCall($office);
		if ($call === null) {
			return null;
		}
		$names = [];
		foreach ($call['participants'] as $uid) {
			$names[$uid] = $this->userManager->getDisplayName($uid) ?? $uid;
		}
		return $call + ['names' => $names];
	}

	/** @return array{known: bool, active: bool, since: ?int, participants: list<string>}|null */
	private function storedCall(Office $office): ?array {
		$talk = $office->getConfigData()['talk'];
		if ($talk === null || !in_array($talk['source'], ['conversation', 'team'], true)) {
			return null;
		}
		if ($talk['source'] === 'team' && !$this->isSharedWithTeam($office->getAudienceId(), $talk['token'])) {
			return null;
		}
		$state = json_decode($office->getRoomState(), true);
		$known = is_array($state['call'] ?? null);
		$call = $known ? $state['call'] : [];
		$participants = [];
		foreach ((array)($call['participants'] ?? []) as $uid) {
			if (is_string($uid)) {
				$participants[] = $uid;
			}
		}
		return [
			'known' => $known && (bool)($call['known'] ?? true),
			'active' => (bool)($call['active'] ?? false),
			'since' => isset($call['since']) ? (int)$call['since'] : null,
			'participants' => $participants,
		];
	}

	/** Whether Talk still lists the conversation as shared with the Team. */
	private function isSharedWithTeam(string $teamId, string $token): bool {
		$key = $teamId . "\0" . $token;
		if (!isset($this->sharedWithTeam[$key])) {
			try {
				// Talk's isSharedWithTeam() is true for any existing conversation.
				$this->sharedWithTeam[$key] = $this->teamManager->hasTeamSupport()
					&& in_array($teamId, $this->teamManager->getProvider('talk')->getTeamsForResource($token), true);
			} catch (\Throwable) {
				$this->sharedWithTeam[$key] = false;
			}
		}
		return $this->sharedWithTeam[$key];
	}

	/** Forgets the call state, e.g. after the office got linked to another conversation. */
	public function forgetCall(Office $office): void {
		$this->mutate([$office->getId()], function (array $locked) {
			$office = reset($locked);
			$state = json_decode($office->getRoomState(), true);
			$state = is_array($state) ? $state : [];
			if (!array_key_exists('call', $state)) {
				throw new NoChangeException(null);
			}
			unset($state['call']);
			$this->officeMapper->updateRoomState($office->getId(), $this->encode($state === [] ? new \stdClass() : $state));
			$office->setRoomState($this->encode($state === [] ? new \stdClass() : $state));
			$this->queue($office, ['kind' => 'call', 'call' => $this->callState($office)]);
			return null;
		});
	}

	/**
	 * Applies a change to the call state of every office linked to a Talk
	 * conversation and tells the people inside.
	 *
	 * @param callable(array{known: bool, active: bool, since: ?int, participants: list<string>}): array{active: bool, since: ?int, participants: list<string>} $change
	 */
	public function updateCall(string $talkToken, callable $change): void {
		foreach ($this->officeMapper->findByTalkToken($talkToken) as $office) {
			if ($this->storedCall($office) === null) {
				continue;
			}
			try {
				$this->mutate([$office->getId()], function (array $locked) use ($change) {
					$office = reset($locked);
					$before = $this->storedCall($office);
					$after = ['known' => true] + $change($before);
					$after['participants'] = array_values(array_unique($after['participants']));
					if ($after === $before) {
						throw new NoChangeException(null);
					}
					$state = json_decode($office->getRoomState(), true);
					$state = is_array($state) ? $state : [];
					$state['call'] = $after;
					$this->officeMapper->updateRoomState($office->getId(), $this->encode($state));
					$office->setRoomState($this->encode($state));
					$this->queue($office, ['kind' => 'call', 'call' => $this->callState($office)]);
					return null;
				});
			} catch (ApiException) {
			}
		}
	}

	/** Tells people in the room that the office settings changed. */
	public function announceConfig(Office $office): void {
		$this->mutate([$office->getId()], function (array $locked) {
			$office = reset($locked);
			$this->queue($office, ['kind' => 'config', 'configRev' => $office->getConfigRev(), 'decor' => $this->decor($office), 'title' => $office->getTitle()]);
			return null;
		});
	}

	/**
	 * Starts a shared focus session of 25 or 50 minutes, or joins the running one.
	 *
	 * @throws ApiException
	 */
	public function joinFocus(IUser $user, Office $office, string $session, mixed $minutes): array {
		$this->requirePresence($user, $office, $session);
		return $this->mutate([$office->getId()], function (array $locked) use ($user, $session, $minutes) {
			$office = reset($locked);
			$this->lockedPresence($user, $office, $session);
			$now = $this->clock->nowMs();
			$focus = $this->focusState($office, $now);
			if ($focus === null) {
				if (!in_array($minutes, self::FOCUS_MINUTES, true)) {
					throw ApiException::invalid('Focus sessions last 25 or 50 minutes');
				}
				$focus = ['startedAt' => $now, 'endsAt' => $now + $minutes * 60_000, 'minutes' => $minutes, 'uids' => []];
			}
			if (in_array($user->getUID(), $focus['uids'], true)) {
				throw new NoChangeException(['focus' => $focus, 'serverTime' => $now]);
			}
			$focus['uids'][] = $user->getUID();
			$this->saveFocus($office, $focus);
			return fn (int $rev) => ['focus' => $focus, 'rev' => $rev, 'serverTime' => $now];
		});
	}

	/** Leaves the focus session; the last one out ends it. */
	public function leaveFocus(IUser $user, Office $office, string $session): array {
		$this->requirePresence($user, $office, $session);
		return $this->mutate([$office->getId()], function (array $locked) use ($user, $session) {
			$office = reset($locked);
			$this->lockedPresence($user, $office, $session);
			$now = $this->clock->nowMs();
			$focus = $this->focusState($office, $now);
			if ($focus === null || !in_array($user->getUID(), $focus['uids'], true)) {
				throw new NoChangeException(['focus' => $focus, 'serverTime' => $now]);
			}
			$focus['uids'] = array_values(array_diff($focus['uids'], [$user->getUID()]));
			$focus = $focus['uids'] === [] ? null : $focus;
			$this->saveFocus($office, $focus);
			return fn (int $rev) => ['focus' => $focus, 'rev' => $rev, 'serverTime' => $now];
		});
	}

	/** @return array{startedAt: int, endsAt: int, minutes: int, uids: list<string>}|null the running session */
	private function focusState(Office $office, int $now): ?array {
		$focus = json_decode($office->getRoomState(), true)['focus'] ?? null;
		return is_array($focus) && ($focus['endsAt'] ?? 0) > $now ? $focus : null;
	}

	private function saveFocus(Office $office, ?array $focus): void {
		$state = json_decode($office->getRoomState(), true);
		$state = is_array($state) ? $state : [];
		$state['focus'] = $focus;
		$this->officeMapper->updateRoomState($office->getId(), $this->encode($state));
		$office->setRoomState($this->encode($state));
		$this->queue($office, ['kind' => 'focus', 'focus' => $focus]);
	}

	/** Tells people in the room to fetch the desks again. */
	public function announceDesks(Office $office): void {
		$this->mutate([$office->getId()], function (array $locked) {
			$office = reset($locked);
			$state = json_decode($office->getRoomState(), true);
			$state = is_array($state) ? $state : [];
			$state['desks'] = (int)($state['desks'] ?? 0) + 1;
			$this->officeMapper->updateRoomState($office->getId(), $this->encode($state));
			$office->setRoomState($this->encode($state));
			$this->queue($office, ['kind' => 'desks', 'desksRev' => $state['desks']]);
			return null;
		});
	}

	/**
	 * Saves the "Today" note and shows it at once in the office the person is in.
	 *
	 * @return array{today: array{text: string, expiresAt: int}|null}
	 * @throws ApiException
	 */
	public function setNote(IUser $user, mixed $text, mixed $expiresAt): array {
		$now = $this->clock->nowMs();
		$note = $this->preferences->setToday($user->getUID(), $text, $expiresAt, $now);
		$uidKey = self::uidKey($user->getUID());
		$row = $this->presenceMapper->findByUidKey($uidKey);
		if ($row !== null) {
			try {
				$this->mutate([$row->getOfficeId()], function (array $locked) use ($uidKey, $note, $now) {
					$office = reset($locked);
					$fresh = $this->presenceMapper->findByUidKey($uidKey);
					if ($fresh === null || $fresh->getOfficeId() !== $office->getId()) {
						return null;
					}
					$fresh->setNote(self::noteJson($note));
					$this->presenceMapper->update($fresh);
					$this->queue($office, ['kind' => 'upsert', 'participant' => $this->participant($fresh, $now)]);
					return null;
				});
			} catch (ApiException) {
				// The office went away; the note is saved anyway.
			}
		}
		return ['today' => $note];
	}

	/**
	 * Deletes the office and every presence in one locked transaction, so no
	 * one can enter in between. With a revision, only deletes when nobody
	 * changed the office since.
	 *
	 * @throws ApiException
	 */
	public function deleteOffice(Office $office, ?int $expectedRev): void {
		$this->mutate([$office->getId()], function (array $locked) use ($expectedRev) {
			$office = reset($locked);
			if ($expectedRev !== null && $office->getConfigRev() !== $expectedRev) {
				throw new ApiException('REVISION_MISMATCH', Http::STATUS_PRECONDITION_FAILED, 'Someone else changed this office', ['revision' => $office->getConfigRev()]);
			}
			$uids = array_map(static fn (Presence $p) => $p->getUid(), $this->presenceMapper->findByOffice($office->getId()));
			$this->presenceMapper->deleteByOffice($office->getId());
			$this->deskMapper->deleteByOffice($office->getId());
			$this->watches->forgetOffice($office->getId());
			$this->rouletteMapper->deleteByOffice($office->getId());
			$this->officeMapper->delete($office);
			$this->queue($office, ['kind' => 'closed'], $uids);
			return null;
		});
	}

	/**
	 * Re-checks access of people whose last check is older than
	 * AUTHORIZATION_MS, on behalf of anyone looking at the office. Someone who
	 * lost access is removed even when their own browser stopped asking.
	 */
	public function revalidate(Office $office, ?string $exceptUid = null): void {
		$now = $this->clock->nowMs();
		foreach ($this->presenceMapper->findByOffice($office->getId()) as $row) {
			if ($row->getUid() === $exceptUid || $row->getLeaseUntil() < $now || $row->getAuthorizedUntil() >= $now) {
				continue;
			}
			$user = $this->userManager->get($row->getUid());
			try {
				if ($user === null) {
					throw ApiException::unavailable();
				}
				$this->accessPolicy->assertCanEnter($user, $office);
				$this->presenceMapper->renewLease($row->getId(), $row->getLeaseUntil(), $now + self::AUTHORIZATION_MS);
			} catch (ApiException $e) {
				if ($e->getApiCode() !== 'AUDIENCE_UNAVAILABLE') {
					$this->evict($row->getUid(), $office->getId(), 'access');
				}
			}
		}
	}

	/** Whether a presence counts as present: lease valid and access confirmed recently. */
	private function isShown(Presence $row, int $now): bool {
		return $row->getLeaseUntil() >= $now && $row->getAuthorizedUntil() >= $now - self::AUTHORIZATION_MS;
	}

	/** Background cleanup of leases that ran out while nobody polled. */
	public function expireStale(int $limit = 100): int {
		$now = $this->clock->nowMs();
		$offices = $this->presenceMapper->findOfficesWithExpired($now, $limit);
		foreach ($offices as $officeId) {
			try {
				$this->mutate([$officeId], function (array $locked) use ($now) {
					$this->removeExpired(reset($locked), $now);
					return null;
				});
			} catch (ApiException) {
				$this->presenceMapper->deleteByOffice($officeId);
			}
		}
		foreach ($this->presenceMapper->findOfficesWithStaleAuthorization($now, $limit) as $officeId) {
			try {
				$this->revalidate($this->officeMapper->findById($officeId));
			} catch (DoesNotExistException) {
				$this->presenceMapper->deleteByOffice($officeId);
			}
		}
		return count($offices);
	}

	/**
	 * Names of the people inside right now, for office cards shown to members.
	 *
	 * @return list<array{uid: string, name: string}>
	 */
	public function present(Office $office, int $limit = 12): array {
		$now = $this->clock->nowMs();
		$people = [];
		foreach ($this->presenceMapper->findByOffice($office->getId()) as $row) {
			if ($this->isShown($row, $now) && count($people) < $limit) {
				$people[] = ['uid' => $row->getUid(), 'name' => $row->getName()];
			}
		}
		return $people;
	}

	/** @return list<int> offices with someone inside right now, of any audience */
	public function activeOfficeIds(): array {
		return $this->presenceMapper->findActiveOfficeIds($this->clock->nowMs(), self::AUTHORIZATION_MS);
	}

	/**
	 * @param list<Office> $offices already authorized for the caller
	 * @return array<string, int> token => people present
	 */
	public function counts(array $offices): array {
		$byId = [];
		foreach ($offices as $office) {
			$byId[$office->getId()] = $office->getToken();
		}
		$result = [];
		foreach ($this->presenceMapper->countActive(array_keys($byId), $this->clock->nowMs(), self::AUTHORIZATION_MS) as $id => $count) {
			$result[$byId[$id]] = $count;
		}
		return $result;
	}

	public static function uidKey(string $uid): string {
		return hash('sha256', $uid);
	}

	/**
	 * @param callable(Presence, int): bool $change returns false when nothing changed
	 */
	private function changeOwn(IUser $user, Office $office, string $session, callable $change): array {
		$this->assertSession($session);
		$this->requirePresence($user, $office, $session);
		return $this->mutate([$office->getId()], function (array $locked) use ($user, $session, $change) {
			$office = reset($locked);
			$row = $this->lockedPresence($user, $office, $session);
			$now = $this->clock->nowMs();
			if (!$change($row, $now)) {
				throw new NoChangeException(['participant' => $this->participant($row, $now), 'serverTime' => $now]);
			}
			$this->presenceMapper->update($row);
			$participant = $this->participant($row, $now);
			$this->queue($office, ['kind' => 'upsert', 'participant' => $participant]);
			return fn (int $rev) => ['rev' => $rev, 'serverTime' => $now, 'participant' => $participant];
		});
	}

	/**
	 * Checks the caller's presence row outside the lock and re-checks access
	 * when the last check is older than AUTHORIZATION_MS.
	 */
	private function requirePresence(IUser $user, Office $office, string $session): Presence {
		$this->assertSession($session);
		$now = $this->clock->nowMs();
		$row = $this->presenceMapper->findByUidKey(self::uidKey($user->getUID()));
		$this->assertOwner($row, $office, $session, $now);
		/** @var Presence $row */
		if ($row->getAuthorizedUntil() < $now) {
			try {
				$this->accessPolicy->assertCanEnter($user, $office);
			} catch (ApiException $e) {
				if ($e->getApiCode() !== 'AUDIENCE_UNAVAILABLE') {
					$this->evict($user->getUID(), $office->getId(), 'access');
				}
				throw $e;
			}
			$this->presenceMapper->renewLease($row->getId(), max($row->getLeaseUntil(), $now + self::LEASE_MS), $now + self::AUTHORIZATION_MS);
			$row->setAuthorizedUntil($now + self::AUTHORIZATION_MS);
		}
		return $row;
	}

	private function lockedPresence(IUser $user, Office $office, string $session): Presence {
		$row = $this->presenceMapper->findByUidKey(self::uidKey($user->getUID()));
		$this->assertOwner($row, $office, $session, $this->clock->nowMs());
		/** @var Presence $row */
		return $row;
	}

	private function assertOwner(?Presence $row, Office $office, string $session, int $now): void {
		if ($row === null || $row->getLeaseUntil() < $now) {
			throw new ApiException('NOT_PRESENT', Http::STATUS_GONE, 'You are no longer in this office');
		}
		if ($row->getOfficeId() !== $office->getId() || $row->getSession() !== $session) {
			throw new ApiException('TAKEN_OVER', Http::STATUS_CONFLICT, 'You continued in another window');
		}
	}

	private function assertSession(string $session): void {
		if (preg_match(self::SESSION_PATTERN, $session) !== 1) {
			throw ApiException::invalid('Invalid session');
		}
	}

	private function hasExpired(Office $office, int $now): bool {
		foreach ($this->presenceMapper->findByOffice($office->getId()) as $row) {
			if ($row->getLeaseUntil() < $now) {
				return true;
			}
		}
		return false;
	}

	/**
	 * Ends a presence inside the office lock, also taking the person out of
	 * the focus session.
	 *
	 * @param list<string> $extraRecipients
	 */
	private function removePresence(Office $office, Presence $row, string $reason, array $extraRecipients = []): void {
		$this->presenceMapper->delete($row);
		$this->queue($office, ['kind' => 'remove', 'uid' => $row->getUid(), 'reason' => $reason], $extraRecipients);
		$focus = json_decode($office->getRoomState(), true)['focus'] ?? null;
		if (is_array($focus) && in_array($row->getUid(), $focus['uids'] ?? [], true)) {
			// An ended session is dropped entirely, so no member list outlives it.
			$running = $this->focusState($office, $this->clock->nowMs()) !== null;
			$focus['uids'] = array_values(array_diff($focus['uids'], [$row->getUid()]));
			$this->saveFocus($office, $running && $focus['uids'] !== [] ? $focus : null);
		}
	}

	private function removeExpired(Office $office, int $now): void {
		foreach ($this->presenceMapper->findByOffice($office->getId()) as $row) {
			if ($row->getLeaseUntil() < $now) {
				$this->removePresence($office, $row, 'timeout');
			}
		}
	}

	/**
	 * Runs $fn with the given offices locked (in id order, to avoid deadlocks)
	 * and pushes the queued events after commit. $fn may return a closure
	 * that receives the new revision of the first office.
	 *
	 * @param list<int> $officeIds
	 * @param callable(array<int, Office>): mixed $fn
	 */
	private function mutate(array $officeIds, callable $fn): mixed {
		$this->pending = [];
		$first = $officeIds[0];
		try {
			[$result, $revs] = $this->atomic(function () use ($officeIds, $fn) {
				$sorted = $officeIds;
				sort($sorted);
				$locked = [];
				foreach (array_unique($sorted) as $id) {
					$locked[$id] = $this->officeMapper->lockAndBump($id);
				}
				$ordered = [];
				foreach ($officeIds as $id) {
					$ordered[$id] = $locked[$id];
				}
				$result = $fn($ordered);
				foreach (array_keys($locked) as $id) {
					if (!isset($this->pending[$id])) {
						$this->pending[$id] = ['token' => $locked[$id]->getToken(), 'events' => [], 'extra' => []];
					}
				}
				return [$result, array_map(static fn (Office $o) => $o->getPresenceRev(), $locked)];
			}, $this->db);
		} catch (NoChangeException $e) {
			$this->pending = [];
			return $e->result;
		} catch (DoesNotExistException) {
			// The office was deleted meanwhile.
			$this->pending = [];
			throw ApiException::unavailable();
		}
		$this->flush($revs);
		return $result instanceof \Closure ? $result($revs[$first]) : $result;
	}

	/** @param array<int, int> $revs */
	private function flush(array $revs): void {
		$now = $this->clock->nowMs();
		foreach ($this->pending as $officeId => $batch) {
			$recipients = $batch['extra'];
			foreach ($this->presenceMapper->findByOffice($officeId) as $row) {
				if ($row->getLeaseUntil() >= $now && $row->getAuthorizedUntil() >= $now) {
					$recipients[] = $row->getUid();
				}
			}
			$this->push->push($recipients, [
				'office' => $batch['token'],
				'rev' => $revs[$officeId],
				'serverTime' => $now,
				'events' => $batch['events'],
			]);
		}
		$this->pending = [];
	}

	/** @param list<string> $extraRecipients */
	private function queue(Office $office, array $event, array $extraRecipients = []): void {
		$id = $office->getId();
		$this->pending[$id] ??= ['token' => $office->getToken(), 'events' => [], 'extra' => []];
		$this->pending[$id]['events'][] = $event;
		array_push($this->pending[$id]['extra'], ...$extraRecipients);
	}

	private function snapshot(Office $office, int $rev, int $now): array {
		$participants = [];
		foreach ($this->presenceMapper->findByOffice($office->getId()) as $row) {
			if ($this->isShown($row, $now)) {
				$participants[] = $this->participant($row, $now);
			}
		}
		$props = [];
		foreach ($office->getActiveProps($now) as $id => $prop) {
			$props[] = ['id' => (string)$id, 'startedAt' => $prop['startedAt'], 'endsAt' => $prop['endsAt']];
		}
		return [
			'office' => $office->getToken(),
			'rev' => $rev,
			'serverTime' => $now,
			'configRev' => $office->getConfigRev(),
			'title' => $office->getTitle(),
			'layoutId' => $office->getLayoutId(),
			'catalogHash' => $this->catalog->hash(),
			'capacity' => $this->settings->roomCapacity(),
			'decor' => $this->decor($office),
			'participants' => $participants,
			'props' => $props,
			'call' => $this->callState($office),
			'desksRev' => $this->desksRev($office),
			'focus' => $this->shownFocus($office, $now, array_column($participants, 'uid')),
		];
	}

	/**
	 * The running focus session with the members still inside.
	 *
	 * @param list<string> $present
	 */
	private function shownFocus(Office $office, int $now, array $present): ?array {
		$focus = $this->focusState($office, $now);
		if ($focus === null) {
			return null;
		}
		$focus['uids'] = array_values(array_intersect($focus['uids'], $present));
		return $focus['uids'] === [] ? null : $focus;
	}

	private function desksRev(Office $office): int {
		return (int)(json_decode($office->getRoomState(), true)['desks'] ?? 0);
	}

	private function participant(Presence $row, int $now): array {
		return [
			'uid' => $row->getUid(),
			'name' => $row->getName(),
			'appearance' => json_decode($row->getAppearance(), true),
			'mode' => $row->getMode(),
			'trajectory' => $row->getTrajectoryData(),
			'emote' => $row->getEmoteData($now),
			'generation' => $row->getGeneration(),
			'enteredAt' => $row->getEnteredAt(),
			'note' => $row->getNoteText($now),
			'birthday' => BirthdayService::isToday($row->getBirthday(), $now),
		];
	}

	/** @return array<string, string> */
	private function decor(Office $office): array {
		return $this->catalog->validateDecor($office->getConfigData()['decor']);
	}

	/** @return array{name: string, appearance: array{creature: string, palette: string, accessory: string}, note: ?string, birthday: ?string} */
	private function profile(IUser $user): array {
		$name = trim($user->getDisplayName());
		if ($name === '') {
			$name = $user->getUID();
		}
		$note = $this->preferences->today($user->getUID(), $this->clock->nowMs());
		return [
			'name' => mb_substr($name, 0, 128),
			'appearance' => $this->preferences->appearance($user->getUID()),
			'note' => self::noteJson($note),
			'birthday' => $this->birthdays->monthDay($user),
		];
	}

	/**
	 * A free cell close to someone in the zone with the most people, or at
	 * the coffee corner when the office is empty.
	 *
	 * @param list<Presence> $present
	 * @return array{0: int, 1: int}
	 */
	private function spawnCell(Office $office, array $present, int $now): array {
		$layout = $this->catalog->layout($office->getLayoutId());
		$occupied = [];
		$byZone = [];
		foreach ($present as $row) {
			$cell = $this->movement->restingCell($row->getTrajectoryData(), $now);
			// A character reaches above its cell and its name tag below and to
			// the sides, so two cells around someone count as taken too.
			foreach ([-2, -1, 0, 1, 2] as $dx) {
				foreach ([-2, -1, 0, 1, 2] as $dy) {
					$occupied[($cell[0] + $dx) . ':' . ($cell[1] + $dy)] = true;
				}
			}
			$byZone[$this->catalog->zoneAt($layout, $cell[0], $cell[1]) ?? ''][] = $cell;
		}
		uasort($byZone, static fn (array $a, array $b) => count($b) <=> count($a));
		$queue = $byZone === [] ? [$layout['zoneAnchors']['coffee'] ?? $layout['spawn'][0]] : reset($byZone);

		// Breadth-first from the people themselves, so the first free cell is next to one of them.
		$seen = [];
		foreach ($queue as $cell) {
			$seen[$cell[0] . ':' . $cell[1]] = true;
		}
		while ($queue !== []) {
			$cell = array_shift($queue);
			if (!isset($occupied[$cell[0] . ':' . $cell[1]]) && $this->catalog->isWalkable($layout, $cell[0], $cell[1])) {
				return $cell;
			}
			foreach ([[1, 0], [-1, 0], [0, 1], [0, -1]] as [$dx, $dy]) {
				$next = [$cell[0] + $dx, $cell[1] + $dy];
				$key = $next[0] . ':' . $next[1];
				if (!isset($seen[$key]) && $this->catalog->isWalkable($layout, $next[0], $next[1])) {
					$seen[$key] = true;
					$queue[] = $next;
				}
			}
		}
		return $layout['spawn'][0];
	}

	/** Unescaped, so 80 characters of any script fit the column. */
	private static function noteJson(?array $note): ?string {
		return $note === null ? null : json_encode($note, JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE);
	}

	private function encode(mixed $value): string {
		return json_encode($value, JSON_THROW_ON_ERROR | JSON_PRESERVE_ZERO_FRACTION);
	}
}
