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

/** Desks people claim in an office, and the "Today" note shown with a present person. */
class Version1002Date20260924000000 extends SimpleMigrationStep {
	#[\Override]
	public function changeSchema(IOutput $output, Closure $schemaClosure, array $options): ?ISchemaWrapper {
		/** @var ISchemaWrapper $schema */
		$schema = $schemaClosure();
		$presence = $schema->getTable('vo_presence');
		if (!$presence->hasColumn('note')) {
			$presence->addColumn('note', Types::STRING, ['notnull' => false, 'length' => 255]);
		}
		if (!$schema->hasTable('vo_desks')) {
			$table = $schema->createTable('vo_desks');
			$table->addColumn('id', Types::BIGINT, ['autoincrement' => true, 'notnull' => true, 'unsigned' => true]);
			$table->addColumn('office_id', Types::BIGINT, ['notnull' => true, 'unsigned' => true]);
			$table->addColumn('desk_id', Types::STRING, ['notnull' => true, 'length' => 16]);
			$table->addColumn('uid', Types::STRING, ['notnull' => true, 'length' => 64]);
			$table->addColumn('uid_key', Types::STRING, ['notnull' => true, 'length' => 64]);
			$table->addColumn('claimed_at', Types::BIGINT, ['notnull' => true, 'unsigned' => true]);
			$table->addColumn('authorized_until', Types::BIGINT, ['notnull' => true, 'unsigned' => true, 'default' => 0]);
			$table->setPrimaryKey(['id']);
			$table->addUniqueIndex(['office_id', 'desk_id'], 'vo_desks_desk');
			$table->addUniqueIndex(['office_id', 'uid_key'], 'vo_desks_user');
			$table->addIndex(['uid_key'], 'vo_desks_uid');
		}
		return $schema;
	}
}
