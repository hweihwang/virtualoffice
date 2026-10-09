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

/** Voice: whether someone has it on, and the short-lived WebRTC signals between two tabs. */
class Version1100Date20261008000000 extends SimpleMigrationStep {
	#[\Override]
	public function changeSchema(IOutput $output, Closure $schemaClosure, array $options): ?ISchemaWrapper {
		/** @var ISchemaWrapper $schema */
		$schema = $schemaClosure();
		$presence = $schema->getTable('vo_presence');
		if (!$presence->hasColumn('voice')) {
			$presence->addColumn('voice', Types::BOOLEAN, ['notnull' => false, 'default' => false]);
		}
		if (!$schema->hasTable('vo_signals')) {
			$table = $schema->createTable('vo_signals');
			$table->addColumn('id', Types::BIGINT, ['autoincrement' => true, 'notnull' => true, 'unsigned' => true]);
			$table->addColumn('office_id', Types::BIGINT, ['notnull' => true, 'unsigned' => true]);
			$table->addColumn('to_session', Types::STRING, ['notnull' => true, 'length' => 32]);
			$table->addColumn('from_session', Types::STRING, ['notnull' => true, 'length' => 32]);
			$table->addColumn('body', Types::TEXT, ['notnull' => true]);
			$table->addColumn('created_at', Types::BIGINT, ['notnull' => true, 'unsigned' => true]);
			$table->setPrimaryKey(['id']);
			$table->addIndex(['office_id', 'to_session'], 'vo_signals_to');
			$table->addIndex(['created_at'], 'vo_signals_created');
		}
		return $schema;
	}
}
