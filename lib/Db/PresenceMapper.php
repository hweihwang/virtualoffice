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

/** @template-extends QBMapper<Presence> */
class PresenceMapper extends QBMapper {
	public function __construct(IDBConnection $db) {
		parent::__construct($db, 'vo_presence', Presence::class);
	}

	public function findByUidKey(string $uidKey): ?Presence {
		$qb = $this->db->getQueryBuilder();
		$qb->select('*')->from($this->getTableName())
			->where($qb->expr()->eq('uid_key', $qb->createNamedParameter($uidKey)));
		try {
			return $this->findEntity($qb);
		} catch (DoesNotExistException) {
			return null;
		}
	}

	/** @return list<Presence> */
	public function findByOffice(int $officeId): array {
		$qb = $this->db->getQueryBuilder();
		$qb->select('*')->from($this->getTableName())
			->where($qb->expr()->eq('office_id', $qb->createNamedParameter($officeId, IQueryBuilder::PARAM_INT)))
			->orderBy('slot');
		return $this->findEntities($qb);
	}

	/**
	 * @param list<int> $officeIds
	 * @return array<int, int> office id => number of people with a valid lease
	 */
	public function countActive(array $officeIds, int $now, int $authorizationGraceMs): array {
		if ($officeIds === []) {
			return [];
		}
		$qb = $this->db->getQueryBuilder();
		$qb->select('office_id')
			->selectAlias($qb->func()->count('id'), 'people')
			->from($this->getTableName())
			->where($qb->expr()->in('office_id', $qb->createNamedParameter($officeIds, IQueryBuilder::PARAM_INT_ARRAY)))
			->andWhere($qb->expr()->gte('lease_until', $qb->createNamedParameter($now, IQueryBuilder::PARAM_INT)))
			->andWhere($qb->expr()->gte('authorized_until', $qb->createNamedParameter($now - $authorizationGraceMs, IQueryBuilder::PARAM_INT)))
			->groupBy('office_id');
		$result = $qb->executeQuery();
		$counts = array_fill_keys($officeIds, 0);
		while ($row = $result->fetch()) {
			$counts[(int)$row['office_id']] = (int)$row['people'];
		}
		$result->closeCursor();
		return $counts;
	}

	/** @return list<int> ids of offices with a live presence whose access was not re-checked in time */
	public function findOfficesWithStaleAuthorization(int $now, int $limit): array {
		$qb = $this->db->getQueryBuilder();
		$qb->selectDistinct('office_id')->from($this->getTableName())
			->where($qb->expr()->gte('lease_until', $qb->createNamedParameter($now, IQueryBuilder::PARAM_INT)))
			->andWhere($qb->expr()->lt('authorized_until', $qb->createNamedParameter($now, IQueryBuilder::PARAM_INT)))
			->setMaxResults($limit);
		$result = $qb->executeQuery();
		$ids = array_map('intval', $result->fetchFirstColumn());
		$result->closeCursor();
		return $ids;
	}

	/** @return list<int> ids of offices that have at least one expired presence */
	public function findOfficesWithExpired(int $now, int $limit): array {
		$qb = $this->db->getQueryBuilder();
		$qb->selectDistinct('office_id')->from($this->getTableName())
			->where($qb->expr()->lt('lease_until', $qb->createNamedParameter($now, IQueryBuilder::PARAM_INT)))
			->setMaxResults($limit);
		$result = $qb->executeQuery();
		$ids = array_map('intval', $result->fetchFirstColumn());
		$result->closeCursor();
		return $ids;
	}

	public function renewLease(int $id, int $leaseUntil, int $authorizedUntil): void {
		$qb = $this->db->getQueryBuilder();
		$qb->update($this->getTableName())
			->set('lease_until', $qb->createNamedParameter($leaseUntil, IQueryBuilder::PARAM_INT))
			->set('authorized_until', $qb->createNamedParameter($authorizedUntil, IQueryBuilder::PARAM_INT))
			->where($qb->expr()->eq('id', $qb->createNamedParameter($id, IQueryBuilder::PARAM_INT)));
		$qb->executeStatement();
	}

	/** @return list<int> offices with at least one person inside */
	public function findActiveOfficeIds(int $now, int $authorizationGraceMs): array {
		$qb = $this->db->getQueryBuilder();
		$qb->selectDistinct('office_id')->from($this->getTableName())
			->where($qb->expr()->gte('lease_until', $qb->createNamedParameter($now, IQueryBuilder::PARAM_INT)))
			->andWhere($qb->expr()->gte('authorized_until', $qb->createNamedParameter($now - $authorizationGraceMs, IQueryBuilder::PARAM_INT)));
		$result = $qb->executeQuery();
		$ids = [];
		while (($id = $result->fetchOne()) !== false) {
			$ids[] = (int)$id;
		}
		$result->closeCursor();
		return $ids;
	}

	public function deleteByOffice(int $officeId): void {
		$qb = $this->db->getQueryBuilder();
		$qb->delete($this->getTableName())
			->where($qb->expr()->eq('office_id', $qb->createNamedParameter($officeId, IQueryBuilder::PARAM_INT)));
		$qb->executeStatement();
	}
}
