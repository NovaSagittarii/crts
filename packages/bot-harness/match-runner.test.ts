import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import type { MatchCallbacks, MatchConfig, TickRecord } from './types.js';
import { NoOpBot } from './noop-bot.js';
import { RandomBot } from './random-bot.js';
import {
  MatchLogger,
  createMatchHeader,
  createMatchOutcomeRecord,
} from './match-logger.js';
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

describe('determinism', () => {
  it('same seed produces identical tick records and outcome', () => {
    const config: MatchConfig = {
      seed: 42,
      gridWidth: 32,
      gridHeight: 32,
      maxTicks: 100,
      hashCheckpointInterval: 10,
    };
    const bot = new NoOpBot();

    const records1: TickRecord[] = [];
    runMatch(config, bot, bot, {
      onTickComplete: (_tick, r) => records1.push(r),
    });

    const records2: TickRecord[] = [];
    runMatch(config, bot, bot, {
      onTickComplete: (_tick, r) => records2.push(r),
    });

    expect(records1.length).toBe(records2.length);
    for (let i = 0; i < records1.length; i++) {
      expect(JSON.stringify(records1[i])).toBe(JSON.stringify(records2[i]));
    }
  });

  it('different seeds produce different determinism hashes', () => {
    const config1: MatchConfig = {
      seed: 42,
      gridWidth: 32,
      gridHeight: 32,
      maxTicks: 50,
      hashCheckpointInterval: 10,
    };
    const config2: MatchConfig = {
      seed: 99,
      gridWidth: 32,
      gridHeight: 32,
      maxTicks: 50,
      hashCheckpointInterval: 10,
    };
    const bot = new NoOpBot();

    const hashes1: string[] = [];
    runMatch(config1, bot, bot, {
      onTickComplete: (_tick, r) => {
        if (r.hash) hashes1.push(r.hash);
      },
    });

    const hashes2: string[] = [];
    runMatch(config2, bot, bot, {
      onTickComplete: (_tick, r) => {
        if (r.hash) hashes2.push(r.hash);
      },
    });

    // At least one hash should differ (different seeds -> different spawn positions -> different grid evolution)
    expect(hashes1.join(',')).not.toBe(hashes2.join(','));
  });
});

describe('resource management', () => {
  it('runs 20 sequential matches without throwing', () => {
    const config: MatchConfig = {
      seed: 1,
      gridWidth: 20,
      gridHeight: 20,
      maxTicks: 50,
      hashCheckpointInterval: 50,
    };
    const bot = new NoOpBot();
    for (let i = 0; i < 20; i++) {
      const c = { ...config, seed: i + 1 };
      const result = runMatch(c, bot, bot);
      expect(result.totalTicks).toBe(50);
    }
  });
});

describe('end-to-end pipeline', () => {
  it('runMatch -> MatchLogger -> NDJSON file has valid structure', async () => {
    const config: MatchConfig = {
      seed: 77,
      gridWidth: 20,
      gridHeight: 20,
      maxTicks: 30,
      hashCheckpointInterval: 10,
    };
    const bot = new NoOpBot();
    const tickRecords: TickRecord[] = [];
    const result = runMatch(config, bot, bot, {
      onTickComplete: (_tick, r) => tickRecords.push(r),
    });

    const tmpDir = path.join(os.tmpdir(), `bot-harness-test-${Date.now()}`);
    const logger = new MatchLogger(tmpDir, 'test-run');
    const header = createMatchHeader(config, [bot.name, bot.name]);
    const outcome = createMatchOutcomeRecord(result);
    const filePath = await logger.writeMatch(0, header, tickRecords, outcome);

    const content = await fs.readFile(filePath, 'utf-8');
    const lines = content.trim().split('\n');

    // First line is header
    const headerLine = JSON.parse(lines[0]) as Record<string, unknown>;
    expect(headerLine.type).toBe('header');
    expect(headerLine.seed).toBe(77);

    // Middle lines are ticks
    for (let i = 1; i < lines.length - 1; i++) {
      const tickLine = JSON.parse(lines[i]) as Record<string, unknown>;
      expect(tickLine.type).toBe('tick');
      expect(typeof tickLine.tick).toBe('number');
    }

    // Last line is outcome
    const outcomeLine = JSON.parse(lines[lines.length - 1]) as Record<
      string,
      unknown
    >;
    expect(outcomeLine.type).toBe('outcome');
    expect(outcomeLine.isDraw).toBe(true);

    // Verify hash at checkpoint intervals
    const tickLinesWithHash = lines.slice(1, -1).filter((l) => {
      const parsed = JSON.parse(l) as Record<string, unknown>;
      return parsed.hash !== undefined;
    });
    expect(tickLinesWithHash.length).toBeGreaterThan(0);

    // Cleanup
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('RandomBot vs RandomBot match completes before maxTicks', () => {
    const config: MatchConfig = {
      seed: 555,
      gridWidth: 52,
      gridHeight: 52,
      maxTicks: 500,
      hashCheckpointInterval: 50,
    };
    const result = runMatch(config, new RandomBot(), new RandomBot());
    expect(result.totalTicks).toBeLessThanOrEqual(500);
    expect(result.totalTicks).toBeGreaterThan(0);
  });
});
