<?php

declare(strict_types=1);

/**
 * SPDX-FileCopyrightText: 2026 Hoang Pham
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

namespace OCA\VirtualOffice\Dashboard;

use OCA\VirtualOffice\AppInfo\Application;
use OCA\VirtualOffice\Db\DeskMapper;
use OCA\VirtualOffice\Db\Office;
use OCA\VirtualOffice\Db\OfficeMapper;
use OCA\VirtualOffice\Exception\ApiException;
use OCA\VirtualOffice\Service\AccessPolicy;
use OCA\VirtualOffice\Service\RoomService;
use OCP\Dashboard\IAPIWidgetV2;
use OCP\Dashboard\IButtonWidget;
use OCP\Dashboard\IIconWidget;
use OCP\Dashboard\IReloadableWidget;
use OCP\Dashboard\Model\WidgetButton;
use OCP\Dashboard\Model\WidgetItem;
use OCP\Dashboard\Model\WidgetItems;
use OCP\IL10N;
use OCP\IURLGenerator;
use OCP\IUser;
use OCP\IUserManager;

/**
 * Who is in your offices right now, then the offices where you have a desk.
 * Built from API items only, so it also works in the mobile apps. It starts
 * from the few offices with someone inside, so no office list is capped.
 */
class OfficesWidget implements IAPIWidgetV2, IIconWidget, IReloadableWidget, IButtonWidget {
	public function __construct(
		private IL10N $l,
		private IURLGenerator $urlGenerator,
		private IUserManager $userManager,
		private OfficeMapper $offices,
		private AccessPolicy $accessPolicy,
		private RoomService $room,
		private DeskMapper $desks,
	) {
	}

	#[\Override]
	public function getId(): string {
		return Application::APP_ID;
	}

	#[\Override]
	public function getTitle(): string {
		return $this->l->t('Virtual Office');
	}

	#[\Override]
	public function getOrder(): int {
		return 30;
	}

	#[\Override]
	public function getIconClass(): string {
		return 'icon-virtualoffice';
	}

	#[\Override]
	public function getIconUrl(): string {
		return $this->urlGenerator->getAbsoluteURL($this->urlGenerator->imagePath(Application::APP_ID, 'app-dark.svg'));
	}

	#[\Override]
	public function getUrl(): ?string {
		return $this->urlGenerator->linkToRouteAbsolute('virtualoffice.page.index');
	}

	#[\Override]
	public function load(): void {
	}

	#[\Override]
	public function getReloadInterval(): int {
		return 60;
	}

	#[\Override]
	public function getItemsV2(string $userId, ?string $since = null, int $limit = 7): WidgetItems {
		$user = $this->userManager->get($userId);
		$empty = $this->l->t('Nobody is in your offices right now');
		if ($user === null) {
			return new WidgetItems([], $empty);
		}
		$deskOffices = array_map(static fn ($desk) => $desk->getOfficeId(), $this->desks->findByUidKey(RoomService::uidKey($userId)));
		$offices = array_values(array_filter(
			$this->offices->findByIds(array_values(array_unique([...$this->room->activeOfficeIds(), ...$deskOffices]))),
			fn (Office $office) => $this->isMember($user, $office),
		));
		$counts = $this->room->counts($offices);

		$busy = [];
		$mine = [];
		foreach ($offices as $office) {
			$link = $this->urlGenerator->linkToRouteAbsolute('virtualoffice.page.office', ['token' => $office->getToken()]);
			if (($counts[$office->getToken()] ?? 0) > 0) {
				$people = $this->room->present($office);
				$first = $people[0] ?? null;
				$busy[] = [$counts[$office->getToken()], new WidgetItem(
					$office->getTitle(),
					$this->names($people, $counts[$office->getToken()]),
					$link,
					$first === null ? $this->getIconUrl() : $this->urlGenerator->linkToRouteAbsolute('core.avatar.getAvatar', ['userId' => $first['uid'], 'size' => 64]),
					$office->getToken(),
				)];
			} elseif (in_array($office->getId(), $deskOffices, true)) {
				$mine[] = new WidgetItem($office->getTitle(), $this->l->t('Nobody there yet · your desk'), $link, $this->getIconUrl(), $office->getToken());
			}
		}
		usort($busy, static fn (array $a, array $b) => $b[0] <=> $a[0]);
		$items = array_slice([...array_column($busy, 1), ...$mine], 0, max(1, $limit));
		return new WidgetItems($items, $empty);
	}

	#[\Override]
	public function getWidgetButtons(string $userId): array {
		return [new WidgetButton(WidgetButton::TYPE_MORE, (string)$this->getUrl(), $this->l->t('All offices'))];
	}

	private function isMember(IUser $user, Office $office): bool {
		try {
			return $this->accessPolicy->isMember($user, $office);
		} catch (ApiException) {
			return false;
		}
	}

	/**
	 * "Alice, Chi and 2 more"
	 *
	 * @param list<array{uid: string, name: string}> $people
	 */
	private function names(array $people, int $count): string {
		$shown = array_slice(array_column($people, 'name'), 0, 2);
		$more = $count - count($shown);
		return $more > 0
			? $this->l->n('%1$s and %2$d more', '%1$s and %2$d more', $more, [implode(', ', $shown), $more])
			: implode(', ', $shown);
	}
}
