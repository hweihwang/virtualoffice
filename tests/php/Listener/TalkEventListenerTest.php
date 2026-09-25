<?php

declare(strict_types=1);

/**
 * SPDX-FileCopyrightText: 2026 Hoang Pham
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

namespace OCA\VirtualOffice\Tests\Listener;

use OCA\Talk\Events\AttendeesRemovedEvent;
use OCA\Talk\Events\CallEndedEvent;
use OCA\Talk\Events\CallStartedEvent;
use OCA\Talk\Events\ParticipantModifiedEvent;
use OCA\Talk\Events\RoomDeletedEvent;
use OCA\Talk\Events\RoomModifiedEvent;
use OCA\Talk\Events\StubAttendee;
use OCA\Talk\Events\StubParticipant;
use OCA\VirtualOffice\Db\Office;
use OCA\VirtualOffice\Db\OfficeMapper;
use OCA\VirtualOffice\Listener\TalkEventListener;
use OCA\VirtualOffice\Service\Clock;
use OCA\VirtualOffice\Service\RoomService;
use PHPUnit\Framework\Attributes\AllowMockObjectsWithoutExpectations;
use PHPUnit\Framework\MockObject\MockObject;
use PHPUnit\Framework\TestCase;
use Psr\Log\NullLogger;

#[AllowMockObjectsWithoutExpectations]
class TalkEventListenerTest extends TestCase {
	private OfficeMapper&MockObject $offices;
	private RoomService&MockObject $room;
	private TalkEventListener $listener;
	private Office $conversationOffice;
	private Office $teamOffice;
	/** @var array{active: bool, since: ?int, participants: list<string>} */
	private array $call = ['active' => false, 'since' => null, 'participants' => []];

	protected function setUp(): void {
		$this->offices = $this->createMock(OfficeMapper::class);
		$this->room = $this->createMock(RoomService::class);
		$clock = $this->createStub(Clock::class);
		$clock->method('nowMs')->willReturn(5000);
		$this->listener = new TalkEventListener($this->offices, $this->room, $clock, new NullLogger());

		$this->conversationOffice = $this->office(1, 'talk', 'conversation');
		$this->teamOffice = $this->office(2, 'team', 'team');
		$this->offices->method('findByTalkToken')->with('abcd1234')->willReturn([$this->conversationOffice, $this->teamOffice]);
		$this->room->method('updateCall')->willReturnCallback(function (string $token, callable $change) {
			$this->call = $change($this->call);
		});
	}

	private function office(int $id, string $kind, string $source): Office {
		$office = new Office();
		$office->setId($id);
		$office->setAudienceKind($kind);
		$office->setConfig(json_encode(['decor' => [], 'talk' => ['source' => $source, 'token' => 'abcd1234', 'label' => 'Old']]));
		return $office;
	}

	public function testDeletedConversationDeletesOnlyItsOwnOffice(): void {
		$this->room->expects($this->once())->method('deleteOffice')->with($this->conversationOffice, null);
		$this->listener->handle(new RoomDeletedEvent('abcd1234'));
	}

	public function testRenameFollowsTheConversation(): void {
		$this->offices->expects($this->once())->method('renameByTalkToken')->with('abcd1234', 'Retro', 5000);
		$this->offices->expects($this->exactly(2))->method('updateIfRevision');
		$this->listener->handle(new RoomModifiedEvent('abcd1234', 'name', '  Retro '));
		$this->assertSame('Retro', $this->teamOffice->getConfigData()['talk']['label']);
	}

	public function testRemovedParticipantsLeaveTheConversationOffice(): void {
		$this->room->expects($this->once())->method('evict')->with('bob', 1, 'access');
		$this->listener->handle(new AttendeesRemovedEvent('abcd1234', [new StubAttendee('users', 'bob'), new StubAttendee('guests', 'x')]));
	}

	public function testCallStateFollowsTheCall(): void {
		$this->listener->handle(new ParticipantModifiedEvent('abcd1234', new StubParticipant(new StubAttendee('users', 'alice')), 'inCall', 7));
		$this->assertSame(['active' => true, 'since' => 5000, 'participants' => ['alice']], $this->call);
		$this->listener->handle(new CallStartedEvent('abcd1234'));
		$this->listener->handle(new ParticipantModifiedEvent('abcd1234', new StubParticipant(new StubAttendee('users', 'bob')), 'inCall', 1));
		$this->listener->handle(new ParticipantModifiedEvent('abcd1234', new StubParticipant(new StubAttendee('users', 'alice')), 'inCall', 0));
		$this->assertSame(['active' => true, 'since' => 5000, 'participants' => ['bob']], $this->call);
		$this->listener->handle(new CallEndedEvent('abcd1234'));
		$this->assertSame(['active' => false, 'since' => null, 'participants' => []], $this->call);
	}

	public function testAFailingOfficeNeverBreaksTalk(): void {
		$this->room->method('evict')->willThrowException(new \RuntimeException('database down'));
		$this->listener->handle(new AttendeesRemovedEvent('abcd1234', [new StubAttendee('users', 'bob')]));
		$this->addToAssertionCount(1);
	}
}
