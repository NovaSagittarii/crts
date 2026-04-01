import { describe, expect, it } from 'vitest';

import { mineSequencePatterns, extractBuildSequence } from './sequence-miner.js';
import type { ParsedMatch } from './types.js';
import type {
  MatchHeader,
  MatchOutcomeRecord,
  TickActionRecord,
  TickEconomyRecord,
  TickRecord,
} from '../types.js';

// ── helpers ────────────────────────────────────────────────────────────

function makeTick(
  tick: number,
  actions: TickActionRecord[] = [],
): TickRecord {
  return {
    type: 'tick',
    tick,
    actions,
    economy: [],
    buildOutcomes: actions.filter((a) => a.actionType === 'build').length,
    destroyOutcomes: 0,
  };
}

function makeHeader(seed = 1): MatchHeader {
  return {
    type: 'header',
    seed,
    config: {
      seed,
      gridWidth: 52,
      gridHeight: 52,
      maxTicks: 200,
      hashCheckpointInterval: 50,
    },
    bots: ['bot-a', 'bot-b'],
    startedAt: '2026-01-01T00:00:00Z',
  };
}

function makeOutcome(totalTicks: number): MatchOutcomeRecord {
  return {
    type: 'outcome',
    totalTicks,
    winner: null,
    ranked: [],
    isDraw: true,
  };
}

function buildAction(
  teamId: number,
  templateId: string,
  result: string = 'applied',
): TickActionRecord {
  return {
    teamId,
    actionType: 'build',
    templateId,
    result,
  };
}

// ── Sequence mining tests ──────────────────────────────────────────────

describe('mineSequencePatterns', () => {
  it('finds common subsequences from multiple sequences', () => {
    const sequences = [
      ['A', 'B', 'C'],
      ['A', 'B', 'D'],
      ['A', 'B', 'C'],
    ];

    const patterns = mineSequencePatterns(sequences, {
      minSupport: 2,
      maxPatternLength: 3,
    });

    // [A, B] should appear with support 3
    const ab = patterns.find(
      (p) => p.pattern.length === 2 && p.pattern[0] === 'A' && p.pattern[1] === 'B',
    );
    expect(ab).toBeDefined();
    expect(ab!.support).toBe(3);

    // [A, B, C] should appear with support 2
    const abc = patterns.find(
      (p) =>
        p.pattern.length === 3 &&
        p.pattern[0] === 'A' &&
        p.pattern[1] === 'B' &&
        p.pattern[2] === 'C',
    );
    expect(abc).toBeDefined();
    expect(abc!.support).toBe(2);
  });

  it('limits pattern length with maxPatternLength=2', () => {
    const sequences = [
      ['A', 'B', 'C'],
      ['A', 'B', 'C'],
    ];

    const patterns = mineSequencePatterns(sequences, {
      minSupport: 2,
      maxPatternLength: 2,
    });

    // No patterns longer than 2 should exist
    for (const p of patterns) {
      expect(p.pattern.length).toBeLessThanOrEqual(2);
    }
  });

  it('excludes patterns below minSupport threshold', () => {
    const sequences = [
      ['A', 'B', 'C'],
      ['D', 'E', 'F'],
      ['A', 'B', 'G'],
    ];

    const patterns = mineSequencePatterns(sequences, {
      minSupport: 3,
      maxPatternLength: 3,
    });

    // No pattern appears in all 3 sequences
    // Only single items that appear in >= 3 sequences would qualify (A only appears in 2)
    for (const p of patterns) {
      expect(p.support).toBeGreaterThanOrEqual(3);
    }
  });

  it('returns empty results for empty sequences', () => {
    const patterns = mineSequencePatterns([], {
      minSupport: 1,
      maxPatternLength: 3,
    });
    expect(patterns).toEqual([]);
  });

  it('discovers single-item patterns', () => {
    const sequences = [
      ['A', 'B'],
      ['A', 'C'],
      ['A', 'D'],
    ];

    const patterns = mineSequencePatterns(sequences, {
      minSupport: 3,
      maxPatternLength: 3,
    });

    // [A] should be found with support 3
    const a = patterns.find(
      (p) => p.pattern.length === 1 && p.pattern[0] === 'A',
    );
    expect(a).toBeDefined();
    expect(a!.support).toBe(3);
  });

  it('handles Conway template vocabulary for build-order mining', () => {
    const sequences = [
      ['block', 'generator', 'glider', 'eater-1'],
      ['block', 'generator', 'block', 'gosper'],
      ['block', 'generator', 'glider', 'eater-1'],
      ['generator', 'block', 'glider'],
      ['block', 'generator', 'eater-1'],
    ];

    const patterns = mineSequencePatterns(sequences, {
      minSupport: 3,
      maxPatternLength: 4,
    });

    // [block, generator] should be common (appears in seq 0, 1, 2, 4)
    const bg = patterns.find(
      (p) =>
        p.pattern.length === 2 &&
        p.pattern[0] === 'block' &&
        p.pattern[1] === 'generator',
    );
    expect(bg).toBeDefined();
    expect(bg!.support).toBeGreaterThanOrEqual(3);

    // Results should be sorted by support descending
    for (let i = 1; i < patterns.length; i++) {
      if (patterns[i].support === patterns[i - 1].support) {
        expect(patterns[i].pattern.length).toBeLessThanOrEqual(
          patterns[i - 1].pattern.length,
        );
      } else {
        expect(patterns[i].support).toBeLessThanOrEqual(
          patterns[i - 1].support,
        );
      }
    }
  });
});

// ── extractBuildSequence tests ─────────────────────────────────────────

describe('extractBuildSequence', () => {
  it('extracts ordered templateIds from applied build actions', () => {
    const ticks = [
      makeTick(1, [buildAction(0, 'block'), buildAction(1, 'generator')]),
      makeTick(2, [buildAction(0, 'glider')]),
      makeTick(3, [buildAction(0, 'eater-1', 'rejected')]),
      makeTick(4, [buildAction(0, 'generator')]),
    ];

    const match: ParsedMatch = {
      header: makeHeader(),
      ticks,
      outcome: makeOutcome(4),
    };

    const seq = extractBuildSequence(match, 0);
    expect(seq).toEqual(['block', 'glider', 'generator']);
  });

  it('returns empty array when no applied builds for team', () => {
    const ticks = [
      makeTick(1, [buildAction(1, 'block')]),
      makeTick(2, [buildAction(0, 'glider', 'rejected')]),
    ];

    const match: ParsedMatch = {
      header: makeHeader(),
      ticks,
      outcome: makeOutcome(2),
    };

    const seq = extractBuildSequence(match, 0);
    expect(seq).toEqual([]);
  });
});
