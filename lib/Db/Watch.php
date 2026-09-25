<?php

declare(strict_types=1);

/**
 * SPDX-FileCopyrightText: 2026 Hoang Pham
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

namespace OCA\VirtualOffice\Db;

use OCP\AppFramework\Db\Entity;

/**
 * Someone asked to be told once when anyone arrives in an office.
 *
 * @method int getOfficeId()
 * @method void setOfficeId(int $id)
 * @method string getUid()
 * @method void setUid(string $uid)
 * @method string getUidKey()
 * @method void setUidKey(string $key)
 * @method int getExpiresAt()
 * @method void setExpiresAt(int $time)
 */
class Watch extends Entity {
	protected int $officeId = 0;
	protected string $uid = '';
	protected string $uidKey = '';
	protected int $expiresAt = 0;

	public function __construct() {
		$this->addType('officeId', 'integer');
		$this->addType('expiresAt', 'integer');
	}
}
