import { describe, expect, test } from 'vitest';

import {
  DEFAULT_CHAT_LOG_MAX_MESSAGES,
  getChatOverflowCount,
} from '../../apps/web/src/chat-log-view-model.js';

describe('getChatOverflowCount', () => {
  test('returns zero when entry count is below cap', () => {
    expect(getChatOverflowCount(20, DEFAULT_CHAT_LOG_MAX_MESSAGES)).toBe(0);
  });

  test('returns zero when entry count matches cap', () => {
    expect(
      getChatOverflowCount(
        DEFAULT_CHAT_LOG_MAX_MESSAGES,
        DEFAULT_CHAT_LOG_MAX_MESSAGES,
      ),
    ).toBe(0);
  });

  test('returns overflow amount when entry count exceeds cap', () => {
    expect(
      getChatOverflowCount(
        DEFAULT_CHAT_LOG_MAX_MESSAGES + 5,
        DEFAULT_CHAT_LOG_MAX_MESSAGES,
      ),
    ).toBe(5);
  });

  test('normalizes negative and fractional values', () => {
    expect(getChatOverflowCount(-4.8, 200.9)).toBe(0);
    expect(getChatOverflowCount(10.9, 3.2)).toBe(7);
  });

  test('treats non-positive cap as prune-all', () => {
    expect(getChatOverflowCount(9, 0)).toBe(9);
    expect(getChatOverflowCount(9, -3)).toBe(9);
  });
});
