<?php

declare(strict_types=1);

/**
 * SPDX-FileCopyrightText: 2026 Hoang Pham
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

namespace OCA\VirtualOffice\BackgroundJob;

use OCA\VirtualOffice\Service\RouletteService;
use OCP\AppFramework\Utility\ITimeFactory;
use OCP\BackgroundJob\TimedJob;

/** Pairs coffee roulette participants once a week. */
class PairRoulette extends TimedJob {
	public function __construct(
		ITimeFactory $time,
		private RouletteService $roulette,
	) {
		parent::__construct($time);
		$this->setInterval(7 * 24 * 3600);
	}

	#[\Override]
	protected function run($argument): void {
		$this->roulette->pairAll();
	}
}
