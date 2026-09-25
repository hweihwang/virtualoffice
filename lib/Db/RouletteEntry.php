<?php

declare(strict_types=1);

/**
 * SPDX-FileCopyrightText: 2026 Hoang Pham
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

namespace OCA\VirtualOffice\Db;

use OCP\AppFramework\Db\Entity;

/**
 * Someone joined an office's coffee roulette. Only the most recent partner
 * is remembered, to avoid pairing the same two people twice in a row.
 *
 * @method int getOfficeId()
 * @method void setOfficeId(int $id)
 * @method string getUid()
 * @method void setUid(string $uid)
 * @method string getUidKey()
 * @method void setUidKey(string $key)
 * @method string|null getLastPartnerKey()
 * @method void setLastPartnerKey(?string $key)
 */
class RouletteEntry extends Entity {
	protected int $officeId = 0;
	protected string $uid = '';
	protected string $uidKey = '';
	protected ?string $lastPartnerKey = null;

	public function __construct() {
		$this->addType('officeId', 'integer');
	}
}
