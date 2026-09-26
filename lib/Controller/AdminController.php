<?php

declare(strict_types=1);

/**
 * SPDX-FileCopyrightText: 2026 Hoang Pham
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

namespace OCA\VirtualOffice\Controller;

use OCA\VirtualOffice\Db\OfficeMapper;
use OCA\VirtualOffice\Service\AccessPolicy;
use OCA\VirtualOffice\Service\OfficeService;
use OCA\VirtualOffice\Service\PushService;
use OCA\VirtualOffice\Service\RoomService;
use OCA\VirtualOffice\Service\Settings;
use OCP\AppFramework\Http\Attribute\ApiRoute;
use OCP\AppFramework\Http\DataResponse;
use OCP\AppFramework\OCSController;
use OCP\IRequest;
use OCP\IUserManager;
use OCP\IUserSession;

/** Admin-only (no NoAdminRequired): settings and a list of every office for repair. */
class AdminController extends OCSController {
	use ApiResponses;

	public function __construct(
		string $appName,
		IRequest $request,
		private Settings $settings,
		private PushService $push,
		private OfficeMapper $mapper,
		private OfficeService $offices,
		private RoomService $room,
		private AccessPolicy $accessPolicy,
		private IUserManager $userManager,
		private IUserSession $userSession,
	) {
		parent::__construct($appName, $request);
	}

	#[ApiRoute(verb: 'GET', url: '/api/v1/admin/settings')]
	public function show(): DataResponse {
		return $this->respond(fn () => $this->settings->toArray() + ['clientPush' => $this->push->isAvailable()]);
	}

	#[ApiRoute(verb: 'PUT', url: '/api/v1/admin/settings')]
	public function update(?int $roomCapacity = null, ?bool $instanceOffices = null): DataResponse {
		return $this->respond(function () use ($roomCapacity, $instanceOffices) {
			if ($roomCapacity !== null) {
				$this->settings->setRoomCapacity($roomCapacity);
			}
			if ($instanceOffices !== null) {
				$this->settings->setInstanceOfficesEnabled($instanceOffices);
			}
			return $this->settings->toArray() + ['clientPush' => $this->push->isAvailable()];
		});
	}

	/** Every office, flagging those without a manager who still belongs to the audience. */
	#[ApiRoute(verb: 'GET', url: '/api/v1/admin/offices')]
	public function offices(int $limit = 50, int $offset = 0): DataResponse {
		return $this->respond(function () use ($limit, $offset) {
			$admin = $this->userSession->getUser();
			$list = $this->mapper->findAll(max(1, min(50, $limit)), max(0, $offset));
			$counts = $this->room->counts($list);
			return array_map(function ($office) use ($admin, $counts) {
				$activeManagers = array_filter($office->getManagerList(), function (string $uid) use ($office) {
					$user = $this->userManager->get($uid);
					try {
						return $user !== null && $this->accessPolicy->isMember($user, $office);
					} catch (\Throwable) {
						return true;
					}
				});
				return $this->offices->definition($admin, $office, $counts[$office->getToken()] ?? 0) + ['unmanaged' => $activeManagers === []];
			}, $list);
		});
	}
}
