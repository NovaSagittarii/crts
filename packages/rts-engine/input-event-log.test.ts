import { describe, expect, test } from 'vitest';

import {
  InputEventLog,
  type InputLogEntry,
  type InputLogEventKind,
} from './input-event-log.js';

function makeEntry(
  tick: number,
  sequence: number,
  kind: InputLogEventKind = 'build',
): InputLogEntry {
  return { tick, sequence, kind, payload: { mock: true } };
}

describe('InputEventLog', () => {
  test('append 3 entries, count returns 3', () => {
    const log = new InputEventLog(8);
    log.append(makeEntry(1, 0));
    log.append(makeEntry(2, 1));
    log.append(makeEntry(3, 2));
    expect(log.count).toBe(3);
  });

  test('getEntriesFromTick(0) returns all entries in insertion order', () => {
    const log = new InputEventLog(8);
    log.append(makeEntry(1, 0));
    log.append(makeEntry(2, 1));
    log.append(makeEntry(3, 2));
    const entries = log.getEntriesFromTick(0);
    expect(entries).toHaveLength(3);
    expect(entries[0].tick).toBe(1);
    expect(entries[1].tick).toBe(2);
    expect(entries[2].tick).toBe(3);
  });

  test('getEntriesFromTick(5) returns only entries with tick >= 5', () => {
    const log = new InputEventLog(8);
    log.append(makeEntry(3, 0));
    log.append(makeEntry(5, 1));
    log.append(makeEntry(7, 2));
    log.append(makeEntry(10, 3));
    const entries = log.getEntriesFromTick(5);
    expect(entries).toHaveLength(3);
    expect(entries[0].tick).toBe(5);
    expect(entries[1].tick).toBe(7);
    expect(entries[2].tick).toBe(10);
  });

  test('discardBefore(3) removes entries with tick < 3, count updates', () => {
    const log = new InputEventLog(8);
    log.append(makeEntry(1, 0));
    log.append(makeEntry(2, 1));
    log.append(makeEntry(3, 2));
    log.append(makeEntry(4, 3));
    log.discardBefore(3);
    expect(log.count).toBe(2);
    const entries = log.getEntriesFromTick(0);
    expect(entries).toHaveLength(2);
    expect(entries[0].tick).toBe(3);
    expect(entries[1].tick).toBe(4);
  });

  test('appending beyond capacity overwrites oldest entry (FIFO ring)', () => {
    const log = new InputEventLog(3);
    log.append(makeEntry(1, 0));
    log.append(makeEntry(2, 1));
    log.append(makeEntry(3, 2));
    // Buffer is full -- next append overwrites oldest
    log.append(makeEntry(4, 3));
    expect(log.count).toBe(3);
    const entries = log.getEntriesFromTick(0);
    expect(entries).toHaveLength(3);
    expect(entries[0].tick).toBe(2);
    expect(entries[1].tick).toBe(3);
    expect(entries[2].tick).toBe(4);
  });

  test('after overwrite, getEntriesFromTick still returns valid entries only', () => {
    const log = new InputEventLog(3);
    log.append(makeEntry(1, 0));
    log.append(makeEntry(2, 1));
    log.append(makeEntry(3, 2));
    log.append(makeEntry(4, 3));
    log.append(makeEntry(5, 4));
    // Oldest two (1 and 2) should be gone, buffer holds [3, 4, 5]
    const all = log.getEntriesFromTick(0);
    expect(all).toHaveLength(3);
    expect(all[0].tick).toBe(3);
    expect(all[1].tick).toBe(4);
    expect(all[2].tick).toBe(5);
    // Filtering from tick 4 excludes tick 3
    const filtered = log.getEntriesFromTick(4);
    expect(filtered).toHaveLength(2);
    expect(filtered[0].tick).toBe(4);
    expect(filtered[1].tick).toBe(5);
  });

  test('clear() resets count to 0 and getEntriesFromTick returns empty', () => {
    const log = new InputEventLog(8);
    log.append(makeEntry(1, 0));
    log.append(makeEntry(2, 1));
    log.clear();
    expect(log.count).toBe(0);
    expect(log.getEntriesFromTick(0)).toEqual([]);
  });

  test('capacity getter returns constructor argument', () => {
    const log = new InputEventLog(16);
    expect(log.capacity).toBe(16);
  });

  test('empty log returns empty from getEntriesFromTick', () => {
    const log = new InputEventLog(8);
    expect(log.getEntriesFromTick(0)).toEqual([]);
    expect(log.count).toBe(0);
  });
});
