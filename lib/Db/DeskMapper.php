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

/** @template-extends QBMapper<Desk> */
class DeskMapper extends QBMapper {
	public function __construct(IDBConnection $db) {
		parent::__construct($db, 'vo_desks', Desk::class);
	}

	/** @return list<Desk> */
	public function findByOffice(int $officeId): array {
		$qb = $this->db->getQueryBuilder();
		$qb->select('*')->from($this->getTableName())
			->where($qb->expr()->eq('office_id', $qb->createNamedParameter($officeId, IQueryBuilder::PARAM_INT)))
			->orderBy('desk_id');
		return $this->findEntities($qb);
	}

	/** @return list<Desk> */
	public function findByUidKey(string $uidKey): array {
		$qb = $this->db->getQueryBuilder();
		$qb->select('*')->from($this->getTableName())
			->where($qb->expr()->eq('uid_key', $qb->createNamedParameter($uidKey)));
		return $this->findEntities($qb);
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

	/** Frees the user's desk in one office, if any. */
	public function deleteFor(int $officeId, string $uidKey): void {
		$qb = $this->db->getQueryBuilder();
		$qb->delete($this->getTableName())
			->where($qb->expr()->eq('office_id', $qb->createNamedParameter($officeId, IQueryBuilder::PARAM_INT)))
			->andWhere($qb->expr()->eq('uid_key', $qb->createNamedParameter($uidKey)));
		$qb->executeStatement();
	}
}
