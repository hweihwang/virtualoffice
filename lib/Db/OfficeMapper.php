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

/** @template-extends QBMapper<Office> */
class OfficeMapper extends QBMapper {
	public function __construct(IDBConnection $db) {
		parent::__construct($db, 'vo_offices', Office::class);
	}

	/** @throws DoesNotExistException */
	public function findByToken(string $token): Office {
		$qb = $this->db->getQueryBuilder();
		$qb->select('*')->from($this->getTableName())
			->where($qb->expr()->eq('token', $qb->createNamedParameter($token)));
		return $this->findEntity($qb);
	}

	/** @throws DoesNotExistException */
	public function findById(int $id): Office {
		$qb = $this->db->getQueryBuilder();
		$qb->select('*')->from($this->getTableName())
			->where($qb->expr()->eq('id', $qb->createNamedParameter($id, IQueryBuilder::PARAM_INT)));
		return $this->findEntity($qb);
	}

	/**
	 * @param list<string> $audienceKeys
	 * @return list<Office>
	 */
	public function findByAudienceKeys(array $audienceKeys, string $search, int $limit, int $offset): array {
		if ($audienceKeys === []) {
			return [];
		}
		$qb = $this->db->getQueryBuilder();
		$qb->select('*')->from($this->getTableName())
			->where($qb->expr()->in('audience_key', $qb->createNamedParameter($audienceKeys, IQueryBuilder::PARAM_STR_ARRAY)))
			->orderBy('title')
			->addOrderBy('id')
			->setMaxResults($limit)
			->setFirstResult($offset);
		if ($search !== '') {
			$qb->andWhere($qb->expr()->iLike('title', $qb->createNamedParameter('%' . $this->db->escapeLikeParameter($search) . '%')));
		}
		return $this->findEntities($qb);
	}

	/** @return list<Office> offices that belong to or link to a Talk conversation */
	public function findByTalkToken(string $token): array {
		$qb = $this->db->getQueryBuilder();
		$qb->select('*')->from($this->getTableName())
			->where($qb->expr()->eq('talk_token', $qb->createNamedParameter($token)));
		return $this->findEntities($qb);
	}

	/** @return list<Office> */
	public function findByKind(string $kind, string $search, int $limit): array {
		$qb = $this->db->getQueryBuilder();
		$qb->select('*')->from($this->getTableName())
			->where($qb->expr()->eq('audience_kind', $qb->createNamedParameter($kind)))
			->orderBy('updated_at', 'DESC')
			->setMaxResults($limit);
		if ($search !== '') {
			$qb->andWhere($qb->expr()->iLike('title', $qb->createNamedParameter('%' . $this->db->escapeLikeParameter($search) . '%')));
		}
		return $this->findEntities($qb);
	}

	/**
	 * @param list<int> $ids
	 * @return list<Office>
	 */
	public function findByIds(array $ids): array {
		$offices = [];
		foreach (array_chunk($ids, 1000) as $chunk) {
			$qb = $this->db->getQueryBuilder();
			$qb->select('*')->from($this->getTableName())
				->where($qb->expr()->in('id', $qb->createNamedParameter($chunk, IQueryBuilder::PARAM_INT_ARRAY)));
			array_push($offices, ...$this->findEntities($qb));
		}
		return $offices;
	}

	/**
	 * Conversation offices of the given conversations.
	 *
	 * @param list<string> $tokens
	 * @return list<Office>
	 */
	public function findTalkByTokens(array $tokens, string $search): array {
		$offices = [];
		foreach (array_chunk($tokens, 1000) as $chunk) {
			$qb = $this->db->getQueryBuilder();
			$qb->select('*')->from($this->getTableName())
				->where($qb->expr()->eq('audience_kind', $qb->createNamedParameter('talk')))
				->andWhere($qb->expr()->in('audience_id', $qb->createNamedParameter($chunk, IQueryBuilder::PARAM_STR_ARRAY)));
			if ($search !== '') {
				$qb->andWhere($qb->expr()->iLike('title', $qb->createNamedParameter('%' . $this->db->escapeLikeParameter($search) . '%')));
			}
			array_push($offices, ...$this->findEntities($qb));
		}
		return $offices;
	}

	/** Renames offices that belong to a conversation, without touching edit revisions. */
	public function renameByTalkToken(string $token, string $title, int $now): void {
		$qb = $this->db->getQueryBuilder();
		$qb->update($this->getTableName())
			->set('title', $qb->createNamedParameter($title))
			->set('updated_at', $qb->createNamedParameter($now, IQueryBuilder::PARAM_INT))
			->where($qb->expr()->eq('talk_token', $qb->createNamedParameter($token)))
			->andWhere($qb->expr()->eq('audience_kind', $qb->createNamedParameter('talk')));
		$qb->executeStatement();
	}

	/** @return list<Office> */
	public function findAll(int $limit, int $offset): array {
		$qb = $this->db->getQueryBuilder();
		$qb->select('*')->from($this->getTableName())
			->orderBy('title')->addOrderBy('id')
			->setMaxResults($limit)->setFirstResult($offset);
		return $this->findEntities($qb);
	}

	/** @return list<Office> */
	public function findWithManager(string $uid): array {
		$qb = $this->db->getQueryBuilder();
		$qb->select('*')->from($this->getTableName())
			->where($qb->expr()->like('managers', $qb->createNamedParameter('%' . $this->db->escapeLikeParameter(json_encode($uid)) . '%')));
		return array_values(array_filter($this->findEntities($qb), static fn (Office $o) => in_array($uid, $o->getManagerList(), true)));
	}

	/**
	 * Take the office's write lock for the current transaction and bump the
	 * presence revision. Returns the fresh office row.
	 */
	public function lockAndBump(int $id): Office {
		$qb = $this->db->getQueryBuilder();
		$qb->update($this->getTableName())
			->set('presence_rev', $qb->createFunction('presence_rev + 1'))
			->where($qb->expr()->eq('id', $qb->createNamedParameter($id, IQueryBuilder::PARAM_INT)));
		if ($qb->executeStatement() !== 1) {
			throw new DoesNotExistException('Office vanished');
		}
		return $this->findById($id);
	}

	public function updateRoomState(int $id, string $roomState): void {
		$qb = $this->db->getQueryBuilder();
		$qb->update($this->getTableName())
			->set('room_state', $qb->createNamedParameter($roomState))
			->where($qb->expr()->eq('id', $qb->createNamedParameter($id, IQueryBuilder::PARAM_INT)));
		$qb->executeStatement();
	}

	/**
	 * Optimistic update: only writes when the stored config revision still matches.
	 * @return bool false when another edit won
	 */
	public function updateIfRevision(Office $office, int $expectedRev): bool {
		$qb = $this->db->getQueryBuilder();
		$qb->update($this->getTableName())
			->set('title', $qb->createNamedParameter($office->getTitle()))
			->set('config', $qb->createNamedParameter($office->getConfig()))
			->set('managers', $qb->createNamedParameter($office->getManagers()))
			->set('removals', $qb->createNamedParameter($office->getRemovals()))
			->set('talk_token', $qb->createNamedParameter($office->getTalkToken()))
			->set('config_rev', $qb->createNamedParameter($expectedRev + 1, IQueryBuilder::PARAM_INT))
			->set('updated_at', $qb->createNamedParameter($office->getUpdatedAt(), IQueryBuilder::PARAM_INT))
			->where($qb->expr()->eq('id', $qb->createNamedParameter($office->getId(), IQueryBuilder::PARAM_INT)))
			->andWhere($qb->expr()->eq('config_rev', $qb->createNamedParameter($expectedRev, IQueryBuilder::PARAM_INT)));
		if ($qb->executeStatement() !== 1) {
			return false;
		}
		$office->setConfigRev($expectedRev + 1);
		return true;
	}

	public function deleteByUserAttribution(string $uid): void {
		$qb = $this->db->getQueryBuilder();
		$qb->update($this->getTableName())
			->set('created_by', $qb->createNamedParameter(null))
			->where($qb->expr()->eq('created_by', $qb->createNamedParameter($uid)));
		$qb->executeStatement();
	}
}
