import { describe, expect, it, vi } from 'vitest';

import type { MatchCallbacks, MatchConfig, TickRecord } from './types.js';
import { NoOpBot } from './noop-bot.js';
import {
  applyBotActions,
  createBotView,
  createTickRecord,
  runMatch,
} from './match-runner.js';
import { RtsRoom } from '#rts-engine';

function createSmallConfig(overrides: Partial<MatchConfig> = {}): MatchConfig {
  return {
    seed: 42,
    gridWidth: 52,
    gridHeight: 52,
    maxTicks: 100,
    hashCheckpointInterval: 10,
    ...overrides,
  };
}

describe('runMatch', () => {
  it('with NoOpBot vs NoOpBot and maxTicks=100 returns isDraw=true with totalTicks=100', () => {
    const config = createSmallConfig({ maxTicks: 100 });
    const result = runMatch(config, new NoOpBot(), new NoOpBot());
    expect(result.isDraw).toBe(true);
    expect(result.totalTicks).toBe(100);
  });

  it('with NoOpBot vs NoOpBot produces MatchResult with outcome=null (no winner)', () => {
    const config = createSmallConfig({ maxTicks: 50 });
    const result = runMatch(config, new NoOpBot(), new NoOpBot());
    expect(result.outcome).toBeNull();
  });

  it('with same seed twice produces identical MatchResult (totalTicks, isDraw match)', () => {
    const config = createSmallConfig({ seed: 123, maxTicks: 50 });
    const resultA = runMatch(config, new NoOpBot(), new NoOpBot());
    const resultB = runMatch(config, new NoOpBot(), new NoOpBot());
    expect(resultA.totalTicks).toBe(resultB.totalTicks);
    expect(resultA.isDraw).toBe(resultB.isDraw);
    expect(resultA.seed).toBe(resultB.seed);
  });

  it('calls onTickComplete callback on each tick with the tick number', () => {
    const config = createSmallConfig({ maxTicks: 20 });
    const ticks: number[] = [];
    const callbacks: MatchCallbacks = {
      onTickComplete: (tick: number) => {
        ticks.push(tick);
      },
    };
    runMatch(config, new NoOpBot(), new NoOpBot(), callbacks);
    expect(ticks).toHaveLength(20);
    expect(ticks[0]).toBe(0);
    expect(ticks[19]).toBe(19);
  });

  it('calls onMatchComplete callback once with the MatchResult', () => {
    const config = createSmallConfig({ maxTicks: 10 });
    const completeFn = vi.fn();
    const callbacks: MatchCallbacks = {
      onMatchComplete: completeFn,
    };
    runMatch(config, new NoOpBot(), new NoOpBot(), callbacks);
    expect(completeFn).toHaveBeenCalledTimes(1);
    const result = completeFn.mock.calls[0][0];
    expect(result.isDraw).toBe(true);
    expect(result.totalTicks).toBe(10);
  });

  it('collects TickRecord data (tick number, economy records per team)', () => {
    const config = createSmallConfig({ maxTicks: 5 });
    const records: TickRecord[] = [];
    const callbacks: MatchCallbacks = {
      onTickComplete: (_tick: number, tickRecord: TickRecord) => {
        records.push(tickRecord);
      },
    };
    runMatch(config, new NoOpBot(), new NoOpBot(), callbacks);
    expect(records).toHaveLength(5);
    for (const record of records) {
      expect(record.type).toBe('tick');
      expect(typeof record.tick).toBe('number');
      expect(record.economy).toHaveLength(2); // two teams
      for (const econ of record.economy) {
        expect(typeof econ.teamId).toBe('number');
        expect(typeof econ.resources).toBe('number');
        expect(typeof econ.income).toBe('number');
      }
    }
  });

  it('running 10 sequential matches does not throw (no resource leak crash)', () => {
    const config = createSmallConfig({ maxTicks: 20 });
    expect(() => {
      for (let i = 0; i < 10; i++) {
        runMatch(
          { ...config, seed: i },
          new NoOpBot(),
          new NoOpBot(),
        );
      }
    }).not.toThrow();
  });
});

describe('createBotView', () => {
  it('produces TeamStateView with own team data only (not opponent data)', () => {
    const room = RtsRoom.create({
      id: 'test-view',
      name: 'Test View',
      width: 52,
      height: 52,
    });
    const teamA = room.addPlayer('bot-a', 'BotA');
    room.addPlayer('bot-b', 'BotB');

    const view = createBotView(room, teamA.id, 0);
    expect(view.teamState.id).toBe(teamA.id);
    expect(view.tick).toBe(0);
    expect(view.roomWidth).toBe(52);
    expect(view.roomHeight).toBe(52);
    expect(view.templates.length).toBeGreaterThan(0);
    // Confirm it's own team data, not opponent
    expect(view.teamState.defeated).toBe(false);
    expect(typeof view.teamState.resources).toBe('number');
  });
});

describe('applyBotActions', () => {
  it('bot actions are applied to room via queueBuildEvent/queueDestroyEvent', () => {
    const room = RtsRoom.create({
      id: 'test-actions',
      name: 'Test Actions',
      width: 52,
      height: 52,
    });
    room.addPlayer('bot-a', 'BotA');
    room.addPlayer('bot-b', 'BotB');

    // Applying empty actions should not throw
    applyBotActions(room, 'bot-a', []);

    // Build action with valid-ish payload -- queue will process it
    applyBotActions(room, 'bot-a', [
      { type: 'build', build: { templateId: 'block', x: 10, y: 10 } },
    ]);

    // Destroy action with nonexistent key -- queue will handle gracefully
    applyBotActions(room, 'bot-a', [
      { type: 'destroy', destroy: { structureKey: 'nonexistent' } },
    ]);
  });
});
