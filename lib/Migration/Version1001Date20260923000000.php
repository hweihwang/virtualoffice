<?php

declare(strict_types=1);

/**
 * SPDX-FileCopyrightText: 2026 Hoang Pham
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

namespace OCA\VirtualOffice\Migration;

use Closure;
use OCP\DB\ISchemaWrapper;
use OCP\DB\QueryBuilder\IQueryBuilder;
use OCP\DB\Types;
use OCP\IDBConnection;
use OCP\Migration\IOutput;
use OCP\Migration\SimpleMigrationStep;

/** Remembers which Talk conversation an office belongs to or links to, so Talk events can find it. */
class Version1001Date20260923000000 extends SimpleMigrationStep {
	public function __construct(
		private IDBConnection $db,
	) {
	}

	#[\Override]
	public function changeSchema(IOutput $output, Closure $schemaClosure, array $options): ?ISchemaWrapper {
		/** @var ISchemaWrapper $schema */
		$schema = $schemaClosure();
		$table = $schema->getTable('vo_offices');
		if ($table->hasColumn('talk_token')) {
			return null;
		}
		$table->addColumn('talk_token', Types::STRING, ['notnull' => false, 'length' => 32]);
		$table->addIndex(['talk_token'], 'vo_offices_talk');
		return $schema;
	}

	#[\Override]
	public function postSchemaChange(IOutput $output, Closure $schemaClosure, array $options): void {
		$select = $this->db->getQueryBuilder();
		$select->select('id', 'config')->from('vo_offices');
		$result = $select->executeQuery();
		while ($row = $result->fetchAssociative()) {
			$token = json_decode((string)$row['config'], true)['talk']['token'] ?? null;
			if (is_string($token)) {
				$update = $this->db->getQueryBuilder();
				$update->update('vo_offices')
					->set('talk_token', $update->createNamedParameter($token))
					->where($update->expr()->eq('id', $update->createNamedParameter((int)$row['id'], IQueryBuilder::PARAM_INT)))
					->executeStatement();
			}
		}
		$result->closeCursor();
	}
}
