<?php

declare(strict_types=1);

/**
 * SPDX-FileCopyrightText: 2026 Hoang Pham
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

namespace OCA\VirtualOffice\Db;

use OCP\AppFramework\Db\QBMapper;
use OCP\DB\QueryBuilder\IQueryBuilder;
use OCP\IDBConnection;

/** @template-extends QBMapper<Signal> */
class SignalMapper extends QBMapper {
	public function __construct(IDBConnection $db) {
		parent::__construct($db, 'vo_signals', Signal::class);
	}

	/** @return list<Signal> signals waiting for one tab, oldest first */
	public function findFor(int $officeId, string $toSession): array {
		$qb = $this->db->getQueryBuilder();
		$qb->select('*')->from($this->getTableName())
			->where($qb->expr()->eq('office_id', $qb->createNamedParameter($officeId, IQueryBuilder::PARAM_INT)))
			->andWhere($qb->expr()->eq('to_session', $qb->createNamedParameter($toSession)))
			->orderBy('id')
			->setMaxResults(50);
		return $this->findEntities($qb);
	}

	/** @param list<int> $ids */
	public function deleteIds(array $ids): void {
		if ($ids === []) {
			return;
		}
		$qb = $this->db->getQueryBuilder();
		$qb->delete($this->getTableName())
			->where($qb->expr()->in('id', $qb->createNamedParameter($ids, IQueryBuilder::PARAM_INT_ARRAY)));
		$qb->executeStatement();
	}

	/** Signals to or from a tab whose presence ended. */
	public function deleteSession(int $officeId, string $session): void {
		$qb = $this->db->getQueryBuilder();
		$qb->delete($this->getTableName())
			->where($qb->expr()->eq('office_id', $qb->createNamedParameter($officeId, IQueryBuilder::PARAM_INT)))
			->andWhere($qb->expr()->orX(
				$qb->expr()->eq('to_session', $qb->createNamedParameter($session)),
				$qb->expr()->eq('from_session', $qb->createNamedParameter($session)),
			));
		$qb->executeStatement();
	}

	public function deleteByOffice(int $officeId): void {
		$qb = $this->db->getQueryBuilder();
		$qb->delete($this->getTableName())
			->where($qb->expr()->eq('office_id', $qb->createNamedParameter($officeId, IQueryBuilder::PARAM_INT)));
		$qb->executeStatement();
	}

	public function deleteCreatedBefore(int $time): int {
		$qb = $this->db->getQueryBuilder();
		$qb->delete($this->getTableName())
			->where($qb->expr()->lt('created_at', $qb->createNamedParameter($time, IQueryBuilder::PARAM_INT)));
		return $qb->executeStatement();
	}
}
