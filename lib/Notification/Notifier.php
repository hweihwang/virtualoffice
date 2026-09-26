<?php

declare(strict_types=1);

/**
 * SPDX-FileCopyrightText: 2026 Hoang Pham
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

namespace OCA\VirtualOffice\Notification;

use OCA\VirtualOffice\AppInfo\Application;
use OCA\VirtualOffice\Db\KnockMapper;
use OCA\VirtualOffice\Db\OfficeMapper;
use OCA\VirtualOffice\Db\PresenceMapper;
use OCA\VirtualOffice\Service\Clock;
use OCA\VirtualOffice\Service\KnockService;
use OCA\VirtualOffice\Service\RoomService;
use OCP\AppFramework\Db\DoesNotExistException;
use OCP\IURLGenerator;
use OCP\IUserManager;
use OCP\L10N\IFactory;
use OCP\Notification\AlreadyProcessedException;
use OCP\Notification\IAction;
use OCP\Notification\INotification;
use OCP\Notification\INotifier;
use OCP\Notification\UnknownNotificationException;

class Notifier implements INotifier {
	public function __construct(
		private IFactory $l10nFactory,
		private IURLGenerator $urlGenerator,
		private IUserManager $userManager,
		private OfficeMapper $offices,
		private KnockMapper $knocks,
		private PresenceMapper $presences,
		private KnockService $knockService,
		private Clock $clock,
	) {
	}

	#[\Override]
	public function getID(): string {
		return Application::APP_ID;
	}

	#[\Override]
	public function getName(): string {
		return $this->l10nFactory->get(Application::APP_ID)->t('Virtual Office');
	}

	#[\Override]
	public function prepare(INotification $notification, string $languageCode): INotification {
		if ($notification->getApp() !== Application::APP_ID || !in_array($notification->getSubject(), ['knock', 'knock_answer', 'arrival', 'pair'], true)) {
			throw new UnknownNotificationException();
		}
		$l = $this->l10nFactory->get(Application::APP_ID, $languageCode);
		$params = $notification->getSubjectParameters();
		try {
			$office = $this->offices->findByToken((string)($params['office'] ?? ''));
		} catch (DoesNotExistException) {
			throw new AlreadyProcessedException();
		}
		$from = (string)($params['from'] ?? '');
		$user = ['type' => 'user', 'id' => $from, 'name' => $this->userManager->getDisplayName($from) ?? $from];
		$notification->setIcon($this->urlGenerator->getAbsoluteURL($this->urlGenerator->imagePath(Application::APP_ID, 'app-dark.svg')))
			// TRANSLATORS %s is the name of the office
			->setParsedMessage($l->t('In %s', [$office->getTitle()]));

		if ($notification->getSubject() === 'knock') {
			if ($this->knocks->findById((int)$notification->getObjectId()) === null) {
				throw new AlreadyProcessedException();
			}
			$this->subject($notification, $l->t('{user} knocked: got 2 minutes?'), $user);
			$notification->setLink($this->urlGenerator->linkToRouteAbsolute('virtualoffice.page.office', ['token' => $office->getToken()]));
			$labels = ['now' => $l->t('Now'), 'soon' => $l->t('In 10 minutes'), 'later' => $l->t('Later')];
			foreach ($notification->getActions() as $action) {
				$action->setParsedLabel($labels[$action->getLabel()] ?? $action->getLabel());
				$notification->addParsedAction($action);
			}
			return $notification;
		}

		if ($notification->getSubject() === 'pair') {
			// Until the next pairing.
			if ($notification->getDateTime()->getTimestamp() * 1000 < $this->clock->nowMs() - 7 * 86_400_000) {
				throw new AlreadyProcessedException();
			}
			$this->subject($notification, $l->t('Coffee roulette: meet {user} this week'), $user);
			$link = $this->knockService->callLink($from, $office);
			$notification->setLink($link);
			$call = $notification->createAction();
			$call->setParsedLabel($l->t('Say hello'))->setLink($link, IAction::TYPE_WEB)->setPrimary(true);
			$notification->addParsedAction($call);
			return $notification;
		}

		if ($notification->getDateTime()->getTimestamp() * 1000 < $this->clock->nowMs() - KnockService::EXPIRY_MS) {
			throw new AlreadyProcessedException();
		}
		$officeLink = $this->urlGenerator->linkToRouteAbsolute('virtualoffice.page.office', ['token' => $office->getToken()]);

		if ($notification->getSubject() === 'arrival') {
			// Only while they are still there.
			$presence = $this->presences->findByUidKey(RoomService::uidKey($from));
			if ($presence === null || $presence->getOfficeId() !== $office->getId()) {
				throw new AlreadyProcessedException();
			}
			$this->subject($notification, $l->t('{user} is in the office'), $user);
			$notification->setLink($officeLink);
			$join = $notification->createAction();
			$join->setParsedLabel($l->t('Join'))->setLink($officeLink, IAction::TYPE_WEB)->setPrimary(true);
			$notification->addParsedAction($join);
			return $notification;
		}

		$answer = (string)($params['answer'] ?? '');
		$this->subject($notification, match ($answer) {
			'now' => $l->t('{user} can talk now'),
			'soon' => $l->t('{user} can talk in 10 minutes'),
			default => $l->t('{user} will get back to you later'),
		}, $user);
		if ($answer === 'now') {
			$link = $this->knockService->callLink($from, $office);
			$notification->setLink($link);
			$call = $notification->createAction();
			$call->setParsedLabel($l->t('Call'))->setLink($link, IAction::TYPE_WEB)->setPrimary(true);
			$notification->addParsedAction($call);
		} else {
			$notification->setLink($officeLink);
		}
		return $notification;
	}

	private function subject(INotification $notification, string $subject, array $user): void {
		$notification->setParsedSubject(str_replace('{user}', $user['name'], $subject))
			->setRichSubject($subject, ['user' => $user]);
	}
}
