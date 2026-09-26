<?php

declare(strict_types=1);

/**
 * SPDX-FileCopyrightText: 2026 Hoang Pham
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

namespace OCA\VirtualOffice\Db;

use OCP\AppFramework\Db\DoesNotExistException;
use OCP\AppFramework\Db\QBMapper;
use OCP\DB\QueryBuilder\IQueryBuilder;
use OCP\IDBConnection;

/** @template-extends QBMapper<RouletteEntry> */
class RouletteMapper extends QBMapper {
	public function __construct(IDBConnection $db) {
		parent::__construct($db, 'vo_roulette', RouletteEntry::class);
	}

	public function findFor(int $officeId, string $uidKey): ?RouletteEntry {
		$qb = $this->db->getQueryBuilder();
		$qb->select('*')->from($this->getTableName())
			->where($qb->expr()->eq('office_id', $qb->createNamedParameter($officeId, IQueryBuilder::PARAM_INT)))
			->andWhere($qb->expr()->eq('uid_key', $qb->createNamedParameter($uidKey)));
		try {
			return $this->findEntity($qb);
		} catch (DoesNotExistException) {
			return null;
		}
	}

	/** @return list<RouletteEntry> */
	public function findByOffice(int $officeId): array {
		$qb = $this->db->getQueryBuilder();
		$qb->select('*')->from($this->getTableName())
			->where($qb->expr()->eq('office_id', $qb->createNamedParameter($officeId, IQueryBuilder::PARAM_INT)));
		return $this->findEntities($qb);
	}

	/** @return list<int> offices where at least two people joined */
	public function findOfficesToPair(): array {
		$qb = $this->db->getQueryBuilder();
		$qb->select('office_id')->from($this->getTableName())
			->groupBy('office_id')
			->having($qb->expr()->gte($qb->func()->count('id'), $qb->createNamedParameter(2, IQueryBuilder::PARAM_INT)));
		$result = $qb->executeQuery();
		$ids = [];
		while (($id = $result->fetchOne()) !== false) {
			$ids[] = (int)$id;
		}
		$result->closeCursor();
		return $ids;
	}

	public function deleteFor(int $officeId, string $uidKey): void {
		$qb = $this->db->getQueryBuilder();
		$qb->delete($this->getTableName())
			->where($qb->expr()->eq('office_id', $qb->createNamedParameter($officeId, IQueryBuilder::PARAM_INT)))
			->andWhere($qb->expr()->eq('uid_key', $qb->createNamedParameter($uidKey)));
		$qb->executeStatement();
	}

	public function deleteByOffice(int $officeId): void {
		$qb = $this->db->getQueryBuilder();
		$qb->delete($this->getTableName())
			->where($qb->expr()->eq('office_id', $qb->createNamedParameter($officeId, IQueryBuilder::PARAM_INT)));
		$qb->executeStatement();
	}

	public function deleteByUidKey(string $uidKey): void {
		$qb = $this->db->getQueryBuilder();
		$qb->delete($this->getTableName())
			->where($qb->expr()->eq('uid_key', $qb->createNamedParameter($uidKey)));
		$qb->executeStatement();
	}
}
