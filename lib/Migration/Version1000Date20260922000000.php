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

class Version1000Date20260922000000 extends SimpleMigrationStep {
	#[\Override]
	public function changeSchema(IOutput $output, Closure $schemaClosure, array $options): ?ISchemaWrapper {
		/** @var ISchemaWrapper $schema */
		$schema = $schemaClosure();

		if (!$schema->hasTable('vo_offices')) {
			$table = $schema->createTable('vo_offices');
			$table->addColumn('id', Types::BIGINT, ['autoincrement' => true, 'notnull' => true, 'unsigned' => true]);
			$table->addColumn('token', Types::STRING, ['notnull' => true, 'length' => 32]);
			$table->addColumn('audience_kind', Types::STRING, ['notnull' => true, 'length' => 16]);
			$table->addColumn('audience_id', Types::STRING, ['notnull' => true, 'length' => 255]);
			$table->addColumn('audience_key', Types::STRING, ['notnull' => true, 'length' => 64]);
			$table->addColumn('title', Types::STRING, ['notnull' => true, 'length' => 120]);
			$table->addColumn('layout_id', Types::STRING, ['notnull' => true, 'length' => 32]);
			$table->addColumn('config', Types::TEXT, ['notnull' => true]);
			$table->addColumn('managers', Types::TEXT, ['notnull' => true]);
			$table->addColumn('removals', Types::TEXT, ['notnull' => true]);
			$table->addColumn('room_state', Types::TEXT, ['notnull' => true]);
			$table->addColumn('config_rev', Types::BIGINT, ['notnull' => true, 'default' => 1, 'unsigned' => true]);
			$table->addColumn('presence_rev', Types::BIGINT, ['notnull' => true, 'default' => 0, 'unsigned' => true]);
			$table->addColumn('created_by', Types::STRING, ['notnull' => false, 'length' => 64]);
			$table->addColumn('created_at', Types::BIGINT, ['notnull' => true, 'unsigned' => true]);
			$table->addColumn('updated_at', Types::BIGINT, ['notnull' => true, 'unsigned' => true]);
			$table->setPrimaryKey(['id']);
			$table->addUniqueIndex(['token'], 'vo_offices_token');
			$table->addIndex(['audience_key'], 'vo_offices_audience');
		}

		if (!$schema->hasTable('vo_presence')) {
			$table = $schema->createTable('vo_presence');
			$table->addColumn('id', Types::BIGINT, ['autoincrement' => true, 'notnull' => true, 'unsigned' => true]);
			$table->addColumn('office_id', Types::BIGINT, ['notnull' => true, 'unsigned' => true]);
			$table->addColumn('slot', Types::SMALLINT, ['notnull' => true, 'unsigned' => true]);
			$table->addColumn('uid', Types::STRING, ['notnull' => true, 'length' => 64]);
			$table->addColumn('uid_key', Types::STRING, ['notnull' => true, 'length' => 64]);
			$table->addColumn('session', Types::STRING, ['notnull' => true, 'length' => 32]);
			$table->addColumn('generation', Types::INTEGER, ['notnull' => true, 'default' => 1, 'unsigned' => true]);
			$table->addColumn('name', Types::STRING, ['notnull' => true, 'length' => 255]);
			$table->addColumn('appearance', Types::STRING, ['notnull' => true, 'length' => 255]);
			$table->addColumn('mode', Types::STRING, ['notnull' => true, 'length' => 16]);
			$table->addColumn('trajectory', Types::TEXT, ['notnull' => true]);
			$table->addColumn('emote', Types::STRING, ['notnull' => false, 'length' => 128]);
			$table->addColumn('lease_until', Types::BIGINT, ['notnull' => true, 'unsigned' => true]);
			$table->addColumn('authorized_until', Types::BIGINT, ['notnull' => true, 'unsigned' => true]);
			$table->addColumn('entered_at', Types::BIGINT, ['notnull' => true, 'unsigned' => true]);
			$table->setPrimaryKey(['id']);
			$table->addUniqueIndex(['uid_key'], 'vo_presence_user');
			$table->addUniqueIndex(['office_id', 'slot'], 'vo_presence_slot');
		}

		return $schema;
	}
}
