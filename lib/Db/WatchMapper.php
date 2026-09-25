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

/** @template-extends QBMapper<Watch> */
class WatchMapper extends QBMapper {
	public function __construct(IDBConnection $db) {
		parent::__construct($db, 'vo_watches', Watch::class);
	}

	public function findFor(int $officeId, string $uidKey): ?Watch {
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

	/** @return list<Watch> */
	public function findActiveByOffice(int $officeId, int $now): array {
		$qb = $this->db->getQueryBuilder();
		$qb->select('*')->from($this->getTableName())
			->where($qb->expr()->eq('office_id', $qb->createNamedParameter($officeId, IQueryBuilder::PARAM_INT)))
			->andWhere($qb->expr()->gt('expires_at', $qb->createNamedParameter($now, IQueryBuilder::PARAM_INT)));
		return $this->findEntities($qb);
	}

	public function deleteFor(int $officeId, string $uidKey): void {
		$qb = $this->db->getQueryBuilder();
		$qb->delete($this->getTableName())
			->where($qb->expr()->eq('office_id', $qb->createNamedParameter($officeId, IQueryBuilder::PARAM_INT)))
			->andWhere($qb->expr()->eq('uid_key', $qb->createNamedParameter($uidKey)));
		$qb->executeStatement();
	}

	public function deleteExpired(int $now): int {
		$qb = $this->db->getQueryBuilder();
		$qb->delete($this->getTableName())
			->where($qb->expr()->lte('expires_at', $qb->createNamedParameter($now, IQueryBuilder::PARAM_INT)));
		return $qb->executeStatement();
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
