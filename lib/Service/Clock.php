<?php

declare(strict_types=1);

/**
 * SPDX-FileCopyrightText: 2026 Hoang Pham
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

namespace OCA\VirtualOffice\Service;

class Clock {
	/** Wall-clock milliseconds. */
	public function nowMs(): int {
		return (int)floor(microtime(true) * 1000.0);
	}
}
