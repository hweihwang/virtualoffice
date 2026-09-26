<?php

declare(strict_types=1);

/**
 * SPDX-FileCopyrightText: 2026 Hoang Pham
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

namespace OCA\VirtualOffice\Command;

use OCA\VirtualOffice\AppInfo\Application;
use OCP\Config\IUserConfig;
use OCP\IAppConfig;
use OCP\IDBConnection;
use OCP\Notification\IManager as INotificationManager;
use Symfony\Component\Console\Command\Command;
use Symfony\Component\Console\Input\InputInterface;
use Symfony\Component\Console\Input\InputOption;
use Symfony\Component\Console\Output\OutputInterface;

/** Deletes Virtual Office data before an intended uninstall. */
class Purge extends Command {
	public function __construct(
		private IDBConnection $db,
		private IAppConfig $appConfig,
		private IUserConfig $userConfig,
		private INotificationManager $notifications,
	) {
		parent::__construct();
	}

	#[\Override]
	protected function configure(): void {
		$this->setName('virtualoffice:purge')
			->setDescription('Delete all Virtual Office data')
			->addOption('force', null, InputOption::VALUE_NONE, 'Confirm the deletion');
	}

	#[\Override]
	protected function execute(InputInterface $input, OutputInterface $output): int {
		if (!$input->getOption('force')) {
			$output->writeln('<error>This deletes every office. Run again with --force to confirm.</error>');
			return self::FAILURE;
		}
		$this->notifications->markProcessed($this->notifications->createNotification()->setApp(Application::APP_ID));
		foreach (['vo_knocks', 'vo_watches', 'vo_roulette', 'vo_desks', 'vo_presence', 'vo_offices'] as $table) {
			$this->db->getQueryBuilder()->delete($table)->executeStatement();
		}
		$this->appConfig->deleteApp(Application::APP_ID);
		$this->userConfig->deleteApp(Application::APP_ID);
		$output->writeln('Virtual Office data deleted.');
		return self::SUCCESS;
	}
}
