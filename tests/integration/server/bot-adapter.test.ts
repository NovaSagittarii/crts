import { describe, expect } from 'vitest';

import type {
  BotAddedPayload,
  MatchStartedPayload,
  RoomErrorPayload,
  RoomJoinedPayload,
  RoomSlotClaimedPayload,
  RoomStatePayload,
} from '#rts-engine';

import { createIntegrationTest } from './fixtures.js';
import {
  claimSlot,
  createClient,
  waitForEvent,
  waitForMembership,
} from './test-support.js';

const test = createIntegrationTest({
  port: 0,
  width: 52,
  height: 52,
  tickMs: 40,
  countdownSeconds: 0,
});

describe('bot:add event', () => {
  test('host can add bot to empty slot', async ({ connectClient }) => {
    // Host connects and auto-joins default room
    const host = connectClient();
    await waitForEvent<RoomJoinedPayload>(host, 'room:joined');

    // Host creates a new room
    const createdPromise = waitForEvent<RoomJoinedPayload>(host, 'room:joined');
    host.emit('room:create', { name: 'Bot Test Room' });
    const created = await createdPromise;
    const roomId = created.roomId;

    // Host emits bot:add
    const botAddedPromise = waitForEvent<BotAddedPayload>(
      host,
      'bot:added',
      5000,
    );
    host.emit('bot:add', { slotId: 'team-2' });
    const botAdded = await botAddedPromise;

    expect(botAdded.roomId).toBe(roomId);
    expect(botAdded.slotId).toBe('team-2');
    expect(botAdded.botSessionId).toMatch(/^bot-/);
  }, 15_000);

  test('non-host receives error', async ({ connectClient }) => {
    // Host connects and creates room
    const host = connectClient();
    await waitForEvent<RoomJoinedPayload>(host, 'room:joined');

    const createdPromise = waitForEvent<RoomJoinedPayload>(host, 'room:joined');
    host.emit('room:create', { name: 'Bot Test Room' });
    const created = await createdPromise;

    // Second client joins the same room
    const guest = connectClient();
    await waitForEvent<RoomJoinedPayload>(guest, 'room:joined');

    const guestJoinedPromise = waitForEvent<RoomJoinedPayload>(
      guest,
      'room:joined',
    );
    guest.emit('room:join', { roomId: created.roomId });
    await guestJoinedPromise;

    // Non-host tries to add bot
    const errorPromise = waitForEvent<RoomErrorPayload>(
      guest,
      'room:error',
      5000,
    );
    guest.emit('bot:add', { slotId: 'team-2' });
    const error = await errorPromise;

    expect(error.reason).toBe('not-host');
  }, 15_000);

  test('rejects when not in lobby', async ({ connectClient }) => {
    // Host connects and creates room
    const host = connectClient();
    await waitForEvent<RoomJoinedPayload>(host, 'room:joined');

    const createdPromise = waitForEvent<RoomJoinedPayload>(host, 'room:joined');
    host.emit('room:create', {
      name: 'Bot Test Room',
      width: 52,
      height: 52,
    });
    const created = await createdPromise;
    const roomId = created.roomId;

    // Guest joins the room
    const guest = connectClient();
    await waitForEvent<RoomJoinedPayload>(guest, 'room:joined');

    const guestJoinedPromise = waitForEvent<RoomJoinedPayload>(
      guest,
      'room:joined',
    );
    guest.emit('room:join', { roomId });
    await guestJoinedPromise;

    // Both claim slots and ready up
    await claimSlot(host, 'team-1');
    await claimSlot(guest, 'team-2');

    const readyMembershipPromise = waitForMembership(
      host,
      roomId,
      (p) =>
        p.participants.filter(({ role, ready }) => role === 'player' && ready)
          .length === 2,
      { attempts: 30 },
    );
    host.emit('room:set-ready', { ready: true });
    guest.emit('room:set-ready', { ready: true });
    await readyMembershipPromise;

    // Start the match
    const matchStartedPromise = waitForEvent<MatchStartedPayload>(
      host,
      'room:match-started',
      7000,
    );
    host.emit('room:start', {});
    await matchStartedPromise;

    // Now try to add bot during active match
    const errorPromise = waitForEvent<RoomErrorPayload>(
      host,
      'room:error',
      5000,
    );
    host.emit('bot:add', { slotId: 'team-2' });
    const error = await errorPromise;

    expect(error.reason).toBe('not-in-lobby');
  }, 20_000);
});

describe('bot client lifecycle', () => {
  test('bot client connects and joins lobby like a human', async ({
    integration,
  }) => {
    const { port, connectClient } = integration;

    // Host connects and creates room
    const host = connectClient();
    await waitForEvent<RoomJoinedPayload>(host, 'room:joined');

    const createdPromise = waitForEvent<RoomJoinedPayload>(host, 'room:joined');
    host.emit('room:create', { name: 'Bot Lifecycle Room' });
    const created = await createdPromise;
    const roomId = created.roomId;

    // Host claims team-1
    await claimSlot(host, 'team-1');

    // Host adds a bot for team-2
    const botAddedPromise = waitForEvent<BotAddedPayload>(
      host,
      'bot:added',
      5000,
    );
    host.emit('bot:add', { slotId: 'team-2' });
    const botAdded = await botAddedPromise;

    // Bot connects with the session ID from bot:added
    const bot = createClient(port, { sessionId: botAdded.botSessionId });

    // Bot auto-joins default room on connection, then explicitly joins
    await waitForEvent<RoomJoinedPayload>(bot, 'room:joined');

    const botJoinedPromise = waitForEvent<RoomJoinedPayload>(
      bot,
      'room:joined',
    );
    bot.emit('room:join', { roomId });
    const botJoined = await botJoinedPromise;
    expect(botJoined.roomId).toBe(roomId);

    // Bot claims slot and sets name
    const botSlotPromise = waitForEvent<RoomSlotClaimedPayload>(
      bot,
      'room:slot-claimed',
    );
    bot.emit('room:claim-slot', { slotId: 'team-2' });
    await botSlotPromise;

    bot.emit('player:set-name', { name: 'Bot (PPO-test)' });

    // Bot readies up
    bot.emit('room:set-ready', { ready: true });

    // Wait for membership showing bot in team-2
    const membership = await waitForMembership(
      host,
      roomId,
      (p) => {
        const botParticipant = p.participants.find(
          (m) => m.sessionId === botAdded.botSessionId,
        );
        return (
          botParticipant !== undefined &&
          botParticipant.isBot === true &&
          botParticipant.slotId === 'team-2'
        );
      },
      { attempts: 30, timeoutMs: 5000 },
    );

    const botParticipant = membership.participants.find(
      (m) => m.sessionId === botAdded.botSessionId,
    );
    expect(botParticipant).toBeDefined();
    expect(botParticipant!.isBot).toBe(true);
    expect(botParticipant!.slotId).toBe('team-2');

    // Clean up
    bot.close();
  }, 20_000);

  test('bot completes full match lifecycle', async ({ integration }) => {
    const { port, connectClient } = integration;

    // Host connects and creates room
    const host = connectClient();
    await waitForEvent<RoomJoinedPayload>(host, 'room:joined');

    const createdPromise = waitForEvent<RoomJoinedPayload>(host, 'room:joined');
    host.emit('room:create', { name: 'Bot Match Room' });
    const created = await createdPromise;
    const roomId = created.roomId;

    // Host claims team-1
    await claimSlot(host, 'team-1');

    // Host adds a bot for team-2
    const botAddedPromise = waitForEvent<BotAddedPayload>(
      host,
      'bot:added',
      5000,
    );
    host.emit('bot:add', { slotId: 'team-2' });
    const botAdded = await botAddedPromise;

    // Bot connects
    const bot = createClient(port, { sessionId: botAdded.botSessionId });
    await waitForEvent<RoomJoinedPayload>(bot, 'room:joined');

    const botJoinedPromise = waitForEvent<RoomJoinedPayload>(
      bot,
      'room:joined',
    );
    bot.emit('room:join', { roomId });
    await botJoinedPromise;

    // Bot claims slot and readies up
    await claimSlot(bot, 'team-2');
    bot.emit('room:set-ready', { ready: true });

    // Host readies up
    host.emit('room:set-ready', { ready: true });

    // Wait for both to be ready
    await waitForMembership(
      host,
      roomId,
      (p) =>
        p.participants.filter(({ role, ready }) => role === 'player' && ready)
          .length === 2,
      { attempts: 30 },
    );

    // Host starts the match (countdownSeconds: 0 so it starts immediately)
    const botMatchStartedPromise = waitForEvent<MatchStartedPayload>(
      bot,
      'room:match-started',
      7000,
    );
    const hostMatchStartedPromise = waitForEvent<MatchStartedPayload>(
      host,
      'room:match-started',
      7000,
    );
    host.emit('room:start', {});
    await Promise.all([botMatchStartedPromise, hostMatchStartedPromise]);

    // Bot should receive at least some state events during active match
    const stateReceived = await new Promise<boolean>((resolve) => {
      let stateCount = 0;
      const timeout = setTimeout(() => {
        bot.off('state', onState);
        resolve(stateCount > 0);
      }, 3000);

      function onState(_payload: RoomStatePayload): void {
        stateCount++;
        if (stateCount >= 3) {
          clearTimeout(timeout);
          bot.off('state', onState);
          resolve(true);
        }
      }

      bot.on('state', onState);
    });

    expect(stateReceived).toBe(true);

    // Clean up
    bot.close();
  }, 25_000);

  test('bot membership shows isBot flag and displayName', async ({
    integration,
  }) => {
    const { port, connectClient } = integration;

    // Host creates room
    const host = connectClient();
    await waitForEvent<RoomJoinedPayload>(host, 'room:joined');

    const createdPromise = waitForEvent<RoomJoinedPayload>(host, 'room:joined');
    host.emit('room:create', { name: 'Bot Badge Room' });
    const created = await createdPromise;
    const roomId = created.roomId;

    await claimSlot(host, 'team-1');

    // Add bot
    const botAddedPromise = waitForEvent<BotAddedPayload>(
      host,
      'bot:added',
      5000,
    );
    host.emit('bot:add', { slotId: 'team-2' });
    const botAdded = await botAddedPromise;

    // Bot connects, joins, claims slot, sets name
    const bot = createClient(port, { sessionId: botAdded.botSessionId });
    await waitForEvent<RoomJoinedPayload>(bot, 'room:joined');

    const botJoinedPromise = waitForEvent<RoomJoinedPayload>(
      bot,
      'room:joined',
    );
    bot.emit('room:join', { roomId });
    await botJoinedPromise;

    bot.emit('room:claim-slot', { slotId: 'team-2' });
    await waitForEvent<RoomSlotClaimedPayload>(bot, 'room:slot-claimed');

    bot.emit('player:set-name', { name: 'Bot (PPO-test)' });

    // Wait for membership to reflect the bot with isBot and displayName
    const membership = await waitForMembership(
      host,
      roomId,
      (p) => {
        const botP = p.participants.find(
          (m) => m.sessionId === botAdded.botSessionId,
        );
        return (
          botP !== undefined &&
          botP.isBot === true &&
          botP.displayName === 'Bot (PPO-test)'
        );
      },
      { attempts: 30, timeoutMs: 5000 },
    );

    const botP = membership.participants.find(
      (m) => m.sessionId === botAdded.botSessionId,
    );
    expect(botP).toBeDefined();
    expect(botP!.isBot).toBe(true);
    expect(botP!.displayName).toBe('Bot (PPO-test)');

    // Clean up
    bot.close();
  }, 20_000);
});
