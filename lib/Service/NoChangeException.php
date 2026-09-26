<?php

declare(strict_types=1);

/**
 * SPDX-FileCopyrightText: 2026 Hoang Pham
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

namespace OCA\VirtualOffice\Service;

/** Rolls back a room transaction that turned out to change nothing. */
class NoChangeException extends \Exception {
	public function __construct(
		public mixed $result,
	) {
		parent::__construct('No change');
	}
}
