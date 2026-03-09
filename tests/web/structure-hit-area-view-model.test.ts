import { describe, expect, it } from 'vitest';

import {
  StructureHitAreaModel,
  type StructureHitAreaStructure,
} from '../../apps/web/src/structure-hit-area-view-model.js';

function createStructure(
  overrides: Partial<StructureHitAreaStructure> = {},
): StructureHitAreaStructure {
  return {
    key: 'alpha',
    x: 10,
    y: 8,
    width: 3,
    height: 2,
    ...overrides,
  };
}

describe('structure hit area view model', () => {
  it('indexes the full outline bounds as the interactive hit area', () => {
    const alpha = createStructure();
    const index = StructureHitAreaModel.buildCellIndex([alpha]);

    expect(
      StructureHitAreaModel.getStructureAtCell(
        {
          x: 11,
          y: 9,
        },
        index,
      ),
    ).toBe(alpha);
  });

  it('keeps first structure precedence for overlapping cells', () => {
    const alpha = createStructure({
      key: 'alpha',
      x: 6,
      y: 6,
      width: 2,
      height: 2,
    });
    const bravo = createStructure({
      key: 'bravo',
      x: 7,
      y: 7,
      width: 2,
      height: 2,
    });
    const index = StructureHitAreaModel.buildCellIndex([alpha, bravo]);

    expect(
      StructureHitAreaModel.getStructureAtCell(
        {
          x: 7,
          y: 7,
        },
        index,
      )?.key,
    ).toBe('alpha');
  });

  it('ignores structures with invalid dimensions', () => {
    const index = StructureHitAreaModel.buildCellIndex([
      createStructure({ key: 'flat', width: 0, height: 2 }),
      createStructure({ key: 'void', width: 2, height: -1 }),
    ]);

    expect(
      StructureHitAreaModel.getStructureAtCell(
        {
          x: 10,
          y: 8,
        },
        index,
      ),
    ).toBeNull();
  });
});
