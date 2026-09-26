<?php

declare(strict_types=1);

/**
 * SPDX-FileCopyrightText: 2026 Hoang Pham
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

namespace OCA\VirtualOffice\Tests\Service;

use OCA\VirtualOffice\Service\ConversationService;
use OCP\Collaboration\Resources\IManager;
use OCP\Collaboration\Resources\IProvider;
use OCP\Collaboration\Resources\IProviderManager;
use OCP\Collaboration\Resources\IResource;
use OCP\Collaboration\Resources\ResourceException;
use OCP\IUser;
use OCP\Talk\IBroker;
use PHPUnit\Framework\TestCase;
use Psr\Log\NullLogger;

class ConversationServiceTest extends TestCase {
	private function service(IProvider ...$providers): ConversationService {
		$providerManager = $this->createStub(IProviderManager::class);
		$providerManager->method('getResourceProviders')->willReturn($providers);
		$resources = $this->createMock(IManager::class);
		$resources->method('createResource')->willReturn($this->createStub(IResource::class));
		// The cached check must never be used; it can keep removed participants.
		$resources->expects($this->never())->method('canAccessResource');
		return new ConversationService($providerManager, $resources, $this->createStub(IBroker::class), new NullLogger());
	}

	private function provider(string $type, callable $canAccess): IProvider {
		$provider = $this->createStub(IProvider::class);
		$provider->method('getType')->willReturn($type);
		$provider->method('canAccessResource')->willReturnCallback($canAccess);
		$provider->method('getResourceRichObject')->willReturn(['name' => 'Standup', 'call-type' => 'group']);
		return $provider;
	}

	public function testAsksTheTalkProviderDirectly(): void {
		$user = $this->createStub(IUser::class);
		$this->assertTrue($this->service($this->provider('file', fn () => false), $this->provider('room', fn () => true))->isParticipant($user, 'abcd1234'));
		$this->assertFalse($this->service($this->provider('room', fn () => throw new ResourceException('Participant not found')))->isParticipant($user, 'abcd1234'));
		$this->assertFalse($this->service($this->provider('file', fn () => true))->isParticipant($user, 'abcd1234'));
	}

	public function testRejectsMalformedTokens(): void {
		$service = $this->service($this->provider('room', fn () => true));
		$this->assertFalse($service->isParticipant($this->createStub(IUser::class), '../etc'));
		$this->assertNull($service->details('ABCD'));
		$this->assertSame(['name' => 'Standup', 'type' => 'group'], $service->details('abcd1234'));
	}
}
