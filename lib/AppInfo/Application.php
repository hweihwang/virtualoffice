<?php

declare(strict_types=1);

/**
 * SPDX-FileCopyrightText: 2026 Hoang Pham
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

namespace OCA\VirtualOffice\AppInfo;

use OCA\VirtualOffice\Dashboard\OfficesWidget;
use OCA\VirtualOffice\Listener\GroupMembershipListener;
use OCA\VirtualOffice\Listener\RenderReferenceListener;
use OCA\VirtualOffice\Listener\TalkEventListener;
use OCA\VirtualOffice\Listener\UserDeletedListener;
use OCA\VirtualOffice\Notification\Notifier;
use OCA\VirtualOffice\Reference\OfficeReferenceProvider;
use OCA\VirtualOffice\Search\OfficeSearchProvider;
use OCA\VirtualOffice\SetupCheck\ClientPushCheck;
use OCA\VirtualOffice\Team\OfficeTeamResourceProvider;
use OCP\AppFramework\App;
use OCP\AppFramework\Bootstrap\IBootContext;
use OCP\AppFramework\Bootstrap\IBootstrap;
use OCP\AppFramework\Bootstrap\IRegistrationContext;
use OCP\Collaboration\Reference\RenderReferenceEvent;
use OCP\Group\Events\UserRemovedEvent;
use OCP\User\Events\UserChangedEvent;
use OCP\User\Events\UserDeletedEvent;

class Application extends App implements IBootstrap {
	public const APP_ID = 'virtualoffice';

	public function __construct() {
		parent::__construct(self::APP_ID);
	}

	#[\Override]
	public function register(IRegistrationContext $context): void {
		$context->registerReferenceProvider(OfficeReferenceProvider::class);
		$context->registerSearchProvider(OfficeSearchProvider::class);
		$context->registerTeamResourceProvider(OfficeTeamResourceProvider::class);
		$context->registerSetupCheck(ClientPushCheck::class);
		$context->registerNotifierService(Notifier::class);
		$context->registerDashboardWidget(OfficesWidget::class);
		$context->registerEventListener(RenderReferenceEvent::class, RenderReferenceListener::class);
		$context->registerEventListener(UserDeletedEvent::class, UserDeletedListener::class);
		$context->registerEventListener(UserChangedEvent::class, UserDeletedListener::class);
		$context->registerEventListener(UserRemovedEvent::class, GroupMembershipListener::class);
		foreach (TalkEventListener::EVENTS as $talkEvent) {
			$context->registerEventListener($talkEvent, TalkEventListener::class);
		}
	}

	#[\Override]
	public function boot(IBootContext $context): void {
	}
}
