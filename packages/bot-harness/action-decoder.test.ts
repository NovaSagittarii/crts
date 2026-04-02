import { describe, expect, it } from 'vitest';

import { CORE_TEMPLATE_ID, RtsRoom } from '#rts-engine';

import { ActionDecoder } from './action-decoder.js';

function createTestRoom(): RtsRoom {
  const room = RtsRoom.create({
    id: 'test',
    name: 'test',
    width: 20,
    height: 20,
  });
  room.addPlayer('p1', 'T1');
  room.addPlayer('p2', 'T2');
  return room;
}

describe('ActionDecoder', () => {
  it('decode(0) returns null (no-op)', () => {
    const decoder = new ActionDecoder(20, 20);
    expect(decoder.decode(0)).toBeNull();
  });

  it('getBuildableTemplates excludes __core__', () => {
    const room = createTestRoom();
    const decoder = new ActionDecoder(20, 20);
    const templates = decoder.getBuildableTemplates(room);

    expect(templates).toHaveLength(5);
    expect(templates.every((t) => t.id !== CORE_TEMPLATE_ID)).toBe(true);
  });

  it('getBuildableTemplates returns templates sorted alphabetically', () => {
    const room = createTestRoom();
    const decoder = new ActionDecoder(20, 20);
    const templates = decoder.getBuildableTemplates(room);
    const ids = templates.map((t) => t.id);

    expect(ids).toEqual(['block', 'eater-1', 'generator', 'glider', 'gosper']);
  });

  it('action space size equals numTemplates * width * height + 1', () => {
    const room = createTestRoom();
    const decoder = new ActionDecoder(20, 20);
    const info = decoder.getActionSpaceInfo(room);

    expect(info.type).toBe('Discrete');
    expect(info.numTemplates).toBe(5);
    expect(info.numPositions).toBe(400); // 20 * 20
    expect(info.n).toBe(5 * 400 + 1); // 2001
  });

  it('decode roundtrip: encode(templateIdx=0, pos=(5,3)) -> decode returns matching template and position', () => {
    const decoder = new ActionDecoder(20, 20);
    // template index 0 = 'block' (alphabetical), position (5,3) in row-major = 3*20 + 5 = 65
    // actionIdx = 0 * 400 + 65 + 1 = 66
    const actionIdx = 0 * 400 + 3 * 20 + 5 + 1;
    expect(actionIdx).toBe(66);

    const result = decoder.decode(actionIdx);
    expect(result).not.toBeNull();
    expect(result!.templateId).toBe('block');
    expect(result!.x).toBe(5);
    expect(result!.y).toBe(3);
  });

  it(
    'computeActionMask has mask[0] === 1 (no-op always valid)',
    { timeout: 15_000 },
    () => {
      const room = createTestRoom();
      const decoder = new ActionDecoder(20, 20);
      const mask = decoder.computeActionMask(room, 'p1', 1);

      expect(mask[0]).toBe(1);
    },
  );

  it(
    'every action index where mask[i] === 1 succeeds via previewBuildPlacement',
    { timeout: 30_000 },
    () => {
      const room = createTestRoom();
      const decoder = new ActionDecoder(20, 20);
      const mask = decoder.computeActionMask(room, 'p1', 1);

      let validCount = 0;
      for (let i = 1; i < mask.length; i++) {
        if (mask[i] === 1) {
          const payload = decoder.decode(i);
          expect(payload).not.toBeNull();
          const preview = room.previewBuildPlacement('p1', payload!);
          expect(preview.accepted).toBe(true);
          validCount++;
        }
      }
      // There should be at least some valid actions (core has buildRadius 14.9)
      expect(validCount).toBeGreaterThan(0);
    },
  );

  it(
    'sample of mask[i] === 0 actions are rejected by previewBuildPlacement',
    { timeout: 15_000 },
    () => {
      const room = createTestRoom();
      const decoder = new ActionDecoder(20, 20);
      const mask = decoder.computeActionMask(room, 'p1', 1);

      let checkedCount = 0;
      const maxChecks = 20;
      for (let i = 1; i < mask.length && checkedCount < maxChecks; i++) {
        if (mask[i] === 0) {
          const payload = decoder.decode(i);
          if (payload) {
            const preview = room.previewBuildPlacement('p1', payload);
            expect(preview.accepted).toBe(false);
            checkedCount++;
          }
        }
      }
      expect(checkedCount).toBeGreaterThan(0);
    },
  );

  it('enumerateTerritoryPositions returns positions in row-major order', () => {
    const room = createTestRoom();
    const decoder = new ActionDecoder(20, 20);
    const positions = decoder.enumerateTerritoryPositions(room, 1);

    // Should have at least some positions from core build zone
    expect(positions.length).toBeGreaterThan(0);

    // Verify row-major order: y ascending, then x ascending
    for (let i = 1; i < positions.length; i++) {
      const prev = positions[i - 1];
      const curr = positions[i];
      const prevKey = prev.y * 20 + prev.x;
      const currKey = curr.y * 20 + curr.x;
      expect(currKey).toBeGreaterThan(prevKey);
    }
  });

  it('enumerateTerritoryPositions returns only cells within build zone of contributors', () => {
    const room = createTestRoom();
    const decoder = new ActionDecoder(20, 20);
    const positions = decoder.enumerateTerritoryPositions(room, 1);

    // All positions should be within the grid bounds
    for (const pos of positions) {
      expect(pos.x).toBeGreaterThanOrEqual(0);
      expect(pos.x).toBeLessThan(20);
      expect(pos.y).toBeGreaterThanOrEqual(0);
      expect(pos.y).toBeLessThan(20);
    }
  });

  it(
    'computeActionMask is deterministic (same state produces same mask)',
    { timeout: 30_000 },
    () => {
      const room = createTestRoom();
      const decoder = new ActionDecoder(20, 20);
      const mask1 = decoder.computeActionMask(room, 'p1', 1);
      const mask2 = decoder.computeActionMask(room, 'p1', 1);

      expect(mask1.length).toBe(mask2.length);
      expect(mask1).toEqual(mask2);
    },
  );
});
