<?php

declare(strict_types=1);

/**
 * SPDX-FileCopyrightText: 2026 Hoang Pham
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

namespace OCA\VirtualOffice\Service;

use OCA\VirtualOffice\AppInfo\Application;
use OCA\VirtualOffice\Db\Knock;
use OCA\VirtualOffice\Db\KnockMapper;
use OCA\VirtualOffice\Db\Office;
use OCA\VirtualOffice\Db\OfficeMapper;
use OCA\VirtualOffice\Exception\ApiException;
use OCP\AppFramework\Db\DoesNotExistException;
use OCP\AppFramework\Http;
use OCP\DB\Exception as DBException;
use OCP\IURLGenerator;
use OCP\IUser;
use OCP\IUserManager;
use OCP\Notification\IAction;
use OCP\Notification\IManager as INotificationManager;

/**
 * "Got 2 minutes?" between two people of an office. The person asked gets a
 * notification with Now, In 10 minutes and Later; the answer goes back the
 * same way. Now opens a one-to-one Talk call for both.
 */
class KnockService {
	public const ANSWERS = ['now', 'soon', 'later'];
	/** Open knocks and answers are dropped after this time. */
	public const EXPIRY_MS = 1_800_000;

	public function __construct(
		private KnockMapper $knocks,
		private OfficeMapper $offices,
		private AccessPolicy $accessPolicy,
		private IUserManager $userManager,
		private INotificationManager $notifications,
		private IURLGenerator $urlGenerator,
		private ConversationService $conversations,
		private PushService $push,
		private Clock $clock,
	) {
	}

	/**
	 * @return array{id: int}
	 * @throws ApiException
	 */
	public function knock(IUser $user, Office $office, mixed $toUid): array {
		$this->accessPolicy->assertCanEnter($user, $office);
		$to = is_string($toUid) && $toUid !== $user->getUID() ? $this->userManager->get($toUid) : null;
		if ($to === null || !$this->accessPolicy->isWelcome($to, $office)) {
			throw new ApiException('PERSON_UNAVAILABLE', Http::STATUS_NOT_FOUND, 'This person cannot be reached here');
		}
		$now = $this->clock->nowMs();
		$knock = new Knock();
		$knock->setOfficeId($office->getId());
		$knock->setFromUid($user->getUID());
		$knock->setFromKey(RoomService::uidKey($user->getUID()));
		$knock->setToUid($to->getUID());
		$knock->setToKey(RoomService::uidKey($to->getUID()));
		$knock->setCreatedAt($now);
		try {
			$this->knocks->insert($knock);
		} catch (DBException $e) {
			if ($e->getReason() !== DBException::REASON_UNIQUE_CONSTRAINT_VIOLATION) {
				throw $e;
			}
			throw new ApiException('KNOCK_PENDING', Http::STATUS_CONFLICT, 'You already knocked; wait for the answer');
		}

		$notification = $this->notifications->createNotification();
		$notification->setApp(Application::APP_ID)
			->setUser($to->getUID())
			->setDateTime(new \DateTime('@' . intdiv($now, 1000)))
			->setObject('knock', (string)$knock->getId())
			->setSubject('knock', ['office' => $office->getToken(), 'from' => $user->getUID()]);
		foreach (self::ANSWERS as $answer) {
			$action = $notification->createAction();
			$action->setLabel($answer)->setPrimary($answer === 'now');
			if ($answer === 'now') {
				// Notifications ignores what a POST action returns, so "Now" opens the
				// office, which answers and continues to the call.
				$action->setLink($this->urlGenerator->linkToRouteAbsolute('virtualoffice.page.office', ['token' => $office->getToken(), 'knock' => $knock->getId(), 'answer' => 'now']), IAction::TYPE_WEB);
			} else {
				$action->setLink($this->urlGenerator->linkToOCSRouteAbsolute('virtualoffice.knock.answer', ['id' => $knock->getId()]) . '?answer=' . $answer, IAction::TYPE_POST);
			}
			$notification->addAction($action);
		}
		$this->notifications->notify($notification);
		$this->push->push([$to->getUID()], [
			'kind' => 'knock',
			'id' => $knock->getId(),
			'office' => $office->getToken(),
			'from' => $user->getUID(),
			'name' => $user->getDisplayName(),
		], PushService::KNOCK_MESSAGE);
		return ['id' => $knock->getId()];
	}

	/**
	 * Answers a knock and tells the person who knocked.
	 *
	 * @return array{link: ?string} where to go now: the call for "now"
	 * @throws ApiException
	 */
	public function answer(IUser $user, int $id, mixed $answer): array {
		if (!in_array($answer, self::ANSWERS, true)) {
			throw ApiException::invalid('Unknown answer');
		}
		$knock = $this->knocks->findById($id);
		if ($knock === null || $knock->getToUid() !== $user->getUID()) {
			throw new ApiException('KNOCK_GONE', Http::STATUS_NOT_FOUND, 'This knock is no longer open');
		}
		$this->knocks->delete($knock);
		$this->dismiss($knock);
		try {
			$office = $this->offices->findById($knock->getOfficeId());
		} catch (DoesNotExistException) {
			return ['link' => null];
		}

		$now = $this->clock->nowMs();
		$notification = $this->notifications->createNotification();
		$notification->setApp(Application::APP_ID)
			->setUser($knock->getFromUid())
			->setDateTime(new \DateTime('@' . intdiv($now, 1000)))
			->setObject('knock_answer', (string)$knock->getId())
			->setSubject('knock_answer', ['office' => $office->getToken(), 'from' => $user->getUID(), 'answer' => $answer]);
		$this->notifications->notify($notification);
		$this->push->push([$knock->getFromUid()], [
			'kind' => 'answer',
			'answer' => $answer,
			'office' => $office->getToken(),
			'from' => $user->getUID(),
			'name' => $user->getDisplayName(),
			'link' => $answer === 'now' ? $this->callLink($user->getUID(), $office) : null,
		], PushService::KNOCK_MESSAGE);
		return ['link' => $answer === 'now' ? $this->callLink($knock->getFromUid(), $office) : null];
	}

	/** Drops knocks nobody answered in time, with their notifications. */
	public function expire(int $limit = 500): int {
		$stale = $this->knocks->findCreatedBefore($this->clock->nowMs() - self::EXPIRY_MS, $limit);
		foreach ($stale as $knock) {
			$this->knocks->delete($knock);
			$this->dismiss($knock);
		}
		return count($stale);
	}

	/** Knocks from or to a deleted account. */
	public function forgetUser(string $uid): void {
		foreach ($this->knocks->findByUidKey(RoomService::uidKey($uid)) as $knock) {
			$this->knocks->delete($knock);
			$this->dismiss($knock);
		}
	}

	/**
	 * A one-to-one Talk call with the other person, or the office without Talk.
	 */
	public function callLink(string $otherUid, Office $office): string {
		if ($this->conversations->isAvailable()) {
			return $this->urlGenerator->getAbsoluteURL($this->urlGenerator->linkTo('', 'index.php') . '/apps/spreed/?callUser=' . rawurlencode($otherUid) . '#direct-call');
		}
		return $this->urlGenerator->linkToRouteAbsolute('virtualoffice.page.office', ['token' => $office->getToken()]);
	}

	private function dismiss(Knock $knock): void {
		$notification = $this->notifications->createNotification();
		$notification->setApp(Application::APP_ID)
			->setUser($knock->getToUid())
			->setObject('knock', (string)$knock->getId());
		$this->notifications->markProcessed($notification);
	}
}
