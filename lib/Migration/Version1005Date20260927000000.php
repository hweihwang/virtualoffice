<?php

declare(strict_types=1);

/**
 * SPDX-FileCopyrightText: 2026 Hoang Pham
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

namespace OCA\VirtualOffice\Migration;

use Closure;
use OCP\DB\ISchemaWrapper;
use OCP\DB\Types;
use OCP\Migration\IOutput;
use OCP\Migration\SimpleMigrationStep;

/** Coffee roulette sign-ups, and the birthday (month and day) of people inside. */
class Version1005Date20260927000000 extends SimpleMigrationStep {
	#[\Override]
	public function changeSchema(IOutput $output, Closure $schemaClosure, array $options): ?ISchemaWrapper {
		/** @var ISchemaWrapper $schema */
		$schema = $schemaClosure();
		$presence = $schema->getTable('vo_presence');
		if (!$presence->hasColumn('birthday')) {
			$presence->addColumn('birthday', Types::STRING, ['notnull' => false, 'length' => 5]);
		}
		if (!$schema->hasTable('vo_roulette')) {
			$table = $schema->createTable('vo_roulette');
			$table->addColumn('id', Types::BIGINT, ['autoincrement' => true, 'notnull' => true, 'unsigned' => true]);
			$table->addColumn('office_id', Types::BIGINT, ['notnull' => true, 'unsigned' => true]);
			$table->addColumn('uid', Types::STRING, ['notnull' => true, 'length' => 64]);
			$table->addColumn('uid_key', Types::STRING, ['notnull' => true, 'length' => 64]);
			$table->addColumn('last_partner_key', Types::STRING, ['notnull' => false, 'length' => 64]);
			$table->setPrimaryKey(['id']);
			$table->addUniqueIndex(['office_id', 'uid_key'], 'vo_roulette_user');
			$table->addIndex(['uid_key'], 'vo_roulette_uid');
		}
		return $schema;
	}
}
