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

/** @template-extends QBMapper<Knock> */
class KnockMapper extends QBMapper {
	public function __construct(IDBConnection $db) {
		parent::__construct($db, 'vo_knocks', Knock::class);
	}

	public function findById(int $id): ?Knock {
		$qb = $this->db->getQueryBuilder();
		$qb->select('*')->from($this->getTableName())
			->where($qb->expr()->eq('id', $qb->createNamedParameter($id, IQueryBuilder::PARAM_INT)));
		try {
			return $this->findEntity($qb);
		} catch (DoesNotExistException) {
			return null;
		}
	}

	/** @return list<Knock> */
	public function findCreatedBefore(int $time, int $limit): array {
		$qb = $this->db->getQueryBuilder();
		$qb->select('*')->from($this->getTableName())
			->where($qb->expr()->lt('created_at', $qb->createNamedParameter($time, IQueryBuilder::PARAM_INT)))
			->setMaxResults($limit);
		return $this->findEntities($qb);
	}

	/** @return list<Knock> knocks from or to the user */
	public function findByUidKey(string $uidKey): array {
		$qb = $this->db->getQueryBuilder();
		$qb->select('*')->from($this->getTableName())
			->where($qb->expr()->orX(
				$qb->expr()->eq('from_key', $qb->createNamedParameter($uidKey)),
				$qb->expr()->eq('to_key', $qb->createNamedParameter($uidKey)),
			));
		return $this->findEntities($qb);
	}
}
