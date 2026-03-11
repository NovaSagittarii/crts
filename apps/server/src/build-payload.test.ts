import { describe, expect, test } from 'vitest';

import { parseBuildPayload } from './build-payload.js';

describe('parseBuildPayload', () => {
  test('accepts valid build payloads with optional transform data', () => {
    expect(
      parseBuildPayload({
        templateId: 'generator',
        x: 10,
        y: 12,
        delayTicks: 3,
        transform: { operations: ['rotate', 'mirror-vertical'] },
      }),
    ).toEqual({
      templateId: 'generator',
      x: 10,
      y: 12,
      delayTicks: 3,
      transform: { operations: ['rotate', 'mirror-vertical'] },
    });
  });

  test('rejects missing, blank, and non-string template ids', () => {
    expect(parseBuildPayload({ x: 1, y: 2 })).toBeNull();
    expect(parseBuildPayload({ templateId: '   ', x: 1, y: 2 })).toBeNull();
    expect(parseBuildPayload({ templateId: 5, x: 1, y: 2 })).toBeNull();
  });

  test('rejects non-integer or non-finite coordinates and delay ticks', () => {
    expect(
      parseBuildPayload({ templateId: 'block', x: '10', y: 2 }),
    ).toBeNull();
    expect(parseBuildPayload({ templateId: 'block', x: 1.5, y: 2 })).toBeNull();
    expect(
      parseBuildPayload({ templateId: 'block', x: 1, y: Number.NaN }),
    ).toBeNull();
    expect(
      parseBuildPayload({
        templateId: 'block',
        x: 1,
        y: 2,
        delayTicks: '3',
      }),
    ).toBeNull();
    expect(
      parseBuildPayload({
        templateId: 'block',
        x: 1,
        y: 2,
        delayTicks: 2.5,
      }),
    ).toBeNull();
  });

  test('rejects malformed transform payloads', () => {
    expect(
      parseBuildPayload({
        templateId: 'block',
        x: 1,
        y: 2,
        transform: { operations: 'rotate' },
      }),
    ).toBeNull();
    expect(
      parseBuildPayload({
        templateId: 'block',
        x: 1,
        y: 2,
        transform: { operations: ['rotate-cw'] },
      }),
    ).toBeNull();
  });
});
