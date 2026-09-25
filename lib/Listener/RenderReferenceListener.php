<?php

declare(strict_types=1);

/**
 * SPDX-FileCopyrightText: 2026 Hoang Pham
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

namespace OCA\VirtualOffice\Listener;

use OCA\VirtualOffice\AppInfo\Application;
use OCP\Collaboration\Reference\RenderReferenceEvent;
use OCP\EventDispatcher\Event;
use OCP\EventDispatcher\IEventListener;
use OCP\Util;

/** @template-implements IEventListener<RenderReferenceEvent> */
class RenderReferenceListener implements IEventListener {
	#[\Override]
	public function handle(Event $event): void {
		if ($event instanceof RenderReferenceEvent) {
			Util::addScript(Application::APP_ID, Application::APP_ID . '-reference');
		}
	}
}
