<?php

declare(strict_types=1);

/**
 * SPDX-FileCopyrightText: 2026 Hoang Pham
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

namespace OCA\VirtualOffice\Db;

use OCP\AppFramework\Db\Entity;

/**
 * A WebRTC offer, answer or goodbye from one tab to another. Deleted when the
 * receiving tab polls, when either presence ends, or after 30 seconds.
 *
 * @method int getOfficeId()
 * @method void setOfficeId(int $id)
 * @method string getToSession()
 * @method void setToSession(string $session)
 * @method string getFromSession()
 * @method void setFromSession(string $session)
 * @method string getBody()
 * @method void setBody(string $body)
 * @method int getCreatedAt()
 * @method void setCreatedAt(int $time)
 */
class Signal extends Entity {
	protected int $officeId = 0;
	protected string $toSession = '';
	protected string $fromSession = '';
	protected string $body = '{}';
	protected int $createdAt = 0;

	public function __construct() {
		$this->addType('officeId', 'integer');
		$this->addType('createdAt', 'integer');
	}
}
