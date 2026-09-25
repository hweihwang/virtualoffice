<?php

declare(strict_types=1);

/**
 * SPDX-FileCopyrightText: 2026 Hoang Pham
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

namespace OCA\VirtualOffice\Db;

use OCP\AppFramework\Db\Entity;

/**
 * An open knock from one person to another. Deleted when answered or after
 * 30 minutes, so no record of who knocked on whom remains.
 *
 * @method int getOfficeId()
 * @method void setOfficeId(int $id)
 * @method string getFromUid()
 * @method void setFromUid(string $uid)
 * @method string getFromKey()
 * @method void setFromKey(string $key)
 * @method string getToUid()
 * @method void setToUid(string $uid)
 * @method string getToKey()
 * @method void setToKey(string $key)
 * @method int getCreatedAt()
 * @method void setCreatedAt(int $time)
 */
class Knock extends Entity {
	protected int $officeId = 0;
	protected string $fromUid = '';
	protected string $fromKey = '';
	protected string $toUid = '';
	protected string $toKey = '';
	protected int $createdAt = 0;

	public function __construct() {
		$this->addType('officeId', 'integer');
		$this->addType('createdAt', 'integer');
	}
}
