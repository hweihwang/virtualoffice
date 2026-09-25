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

/** One-time "tell me when someone arrives" requests, deleted when they fire or expire. */
class Version1004Date20260926000000 extends SimpleMigrationStep {
	#[\Override]
	public function changeSchema(IOutput $output, Closure $schemaClosure, array $options): ?ISchemaWrapper {
		/** @var ISchemaWrapper $schema */
		$schema = $schemaClosure();
		if ($schema->hasTable('vo_watches')) {
			return null;
		}
		$table = $schema->createTable('vo_watches');
		$table->addColumn('id', Types::BIGINT, ['autoincrement' => true, 'notnull' => true, 'unsigned' => true]);
		$table->addColumn('office_id', Types::BIGINT, ['notnull' => true, 'unsigned' => true]);
		$table->addColumn('uid', Types::STRING, ['notnull' => true, 'length' => 64]);
		$table->addColumn('uid_key', Types::STRING, ['notnull' => true, 'length' => 64]);
		$table->addColumn('expires_at', Types::BIGINT, ['notnull' => true, 'unsigned' => true]);
		$table->setPrimaryKey(['id']);
		$table->addUniqueIndex(['office_id', 'uid_key'], 'vo_watches_user');
		$table->addIndex(['uid_key'], 'vo_watches_uid');
		$table->addIndex(['expires_at'], 'vo_watches_expiry');
		return $schema;
	}
}
