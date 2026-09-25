<?php

declare(strict_types=1);

/**
 * SPDX-FileCopyrightText: 2026 Hoang Pham
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

namespace OCA\VirtualOffice\Db;

use OCP\AppFramework\Db\Entity;

/**
 * A desk someone claimed in an office. Holds no visit data: only who owns
 * which desk until they release it or lose access.
 *
 * @method int getOfficeId()
 * @method void setOfficeId(int $id)
 * @method string getDeskId()
 * @method void setDeskId(string $id)
 * @method string getUid()
 * @method void setUid(string $uid)
 * @method string getUidKey()
 * @method void setUidKey(string $key)
 * @method int getClaimedAt()
 * @method void setClaimedAt(int $time)
 * @method int getAuthorizedUntil()
 * @method void setAuthorizedUntil(int $time)
 */
class Desk extends Entity {
	protected int $officeId = 0;
	protected string $deskId = '';
	protected string $uid = '';
	protected string $uidKey = '';
	protected int $claimedAt = 0;
	protected int $authorizedUntil = 0;

	public function __construct() {
		$this->addType('officeId', 'integer');
		$this->addType('claimedAt', 'integer');
		$this->addType('authorizedUntil', 'integer');
	}
}
