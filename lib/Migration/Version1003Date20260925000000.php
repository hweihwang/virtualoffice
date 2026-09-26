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

/** Open knocks ("got 2 minutes?"); answered or 30-minute-old knocks are deleted. */
class Version1003Date20260925000000 extends SimpleMigrationStep {
	#[\Override]
	public function changeSchema(IOutput $output, Closure $schemaClosure, array $options): ?ISchemaWrapper {
		/** @var ISchemaWrapper $schema */
		$schema = $schemaClosure();
		if ($schema->hasTable('vo_knocks')) {
			return null;
		}
		$table = $schema->createTable('vo_knocks');
		$table->addColumn('id', Types::BIGINT, ['autoincrement' => true, 'notnull' => true, 'unsigned' => true]);
		$table->addColumn('office_id', Types::BIGINT, ['notnull' => true, 'unsigned' => true]);
		$table->addColumn('from_uid', Types::STRING, ['notnull' => true, 'length' => 64]);
		$table->addColumn('from_key', Types::STRING, ['notnull' => true, 'length' => 64]);
		$table->addColumn('to_uid', Types::STRING, ['notnull' => true, 'length' => 64]);
		$table->addColumn('to_key', Types::STRING, ['notnull' => true, 'length' => 64]);
		$table->addColumn('created_at', Types::BIGINT, ['notnull' => true, 'unsigned' => true]);
		$table->setPrimaryKey(['id']);
		$table->addUniqueIndex(['office_id', 'from_key', 'to_key'], 'vo_knocks_pair');
		$table->addIndex(['created_at'], 'vo_knocks_created');
		return $schema;
	}
}
