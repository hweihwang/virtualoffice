<?php

declare(strict_types=1);

/**
 * SPDX-FileCopyrightText: 2026 Hoang Pham
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

namespace OCA\VirtualOffice\Db;

use OCP\AppFramework\Db\Entity;

/**
 * @method string getToken()
 * @method void setToken(string $token)
 * @method string getAudienceKind()
 * @method void setAudienceKind(string $kind)
 * @method string getAudienceId()
 * @method void setAudienceId(string $id)
 * @method string getAudienceKey()
 * @method void setAudienceKey(string $key)
 * @method string getTitle()
 * @method void setTitle(string $title)
 * @method string getLayoutId()
 * @method void setLayoutId(string $layoutId)
 * @method string getConfig()
 * @method void setConfig(string $config)
 * @method string getManagers()
 * @method void setManagers(string $managers)
 * @method string getRemovals()
 * @method void setRemovals(string $removals)
 * @method string getRoomState()
 * @method void setRoomState(string $roomState)
 * @method int getConfigRev()
 * @method void setConfigRev(int $rev)
 * @method int getPresenceRev()
 * @method void setPresenceRev(int $rev)
 * @method string|null getTalkToken()
 * @method void setTalkToken(?string $token)
 * @method string|null getCreatedBy()
 * @method void setCreatedBy(?string $uid)
 * @method int getCreatedAt()
 * @method void setCreatedAt(int $time)
 * @method int getUpdatedAt()
 * @method void setUpdatedAt(int $time)
 */
class Office extends Entity {
	protected string $token = '';
	protected string $audienceKind = '';
	protected string $audienceId = '';
	protected string $audienceKey = '';
	protected string $title = '';
	protected string $layoutId = '';
	protected string $config = '{}';
	protected string $managers = '[]';
	protected string $removals = '{}';
	protected string $roomState = '{}';
	protected int $configRev = 1;
	protected int $presenceRev = 0;
	protected ?string $createdBy = null;
	protected ?string $talkToken = null;
	protected int $createdAt = 0;
	protected int $updatedAt = 0;

	public function __construct() {
		$this->addType('configRev', 'integer');
		$this->addType('presenceRev', 'integer');
		$this->addType('createdAt', 'integer');
		$this->addType('updatedAt', 'integer');
	}

	/** Insert every column, including values equal to the property defaults. */
	public function markAllFieldsUpdated(): void {
		foreach (array_keys(get_object_vars($this)) as $field) {
			if ($field !== 'id' && !str_starts_with($field, '_')) {
				$this->markFieldUpdated($field);
			}
		}
	}

	/** @return array{decor: array<string, string>, talk: ?array{source: string, token: string, label: string}} */
	public function getConfigData(): array {
		$data = json_decode($this->config, true);
		return [
			'decor' => is_array($data['decor'] ?? null) ? $data['decor'] : [],
			'talk' => is_array($data['talk'] ?? null) ? $data['talk'] : null,
		];
	}

	/** @return list<string> */
	public function getManagerList(): array {
		$data = json_decode($this->managers, true);
		return is_array($data) ? array_values(array_filter($data, 'is_string')) : [];
	}

	/** @return array<string, int> uid => removed until (ms) */
	public function getRemovalMap(): array {
		$data = json_decode($this->removals, true);
		return is_array($data) ? array_map('intval', $data) : [];
	}

	/** @return array<string, array{startedAt: int, endsAt: int}> */
	public function getActiveProps(int $now): array {
		$data = json_decode($this->roomState, true);
		$props = is_array($data['props'] ?? null) ? $data['props'] : [];
		return array_filter($props, static fn ($p) => is_array($p) && ($p['endsAt'] ?? 0) > $now);
	}
}
