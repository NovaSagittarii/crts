import { describe, expect, test } from 'vitest';

import { BUILD_ZONE_RADIUS } from './gameplay-rules.js';
import {
  collectBuildZoneContributors,
  collectIllegalBuildZoneCells,
  isBuildZoneCoveredByContributor,
} from './build-zone.js';

interface Cell {
  x: number;
  y: number;
}

describe('build-zone helpers', () => {
  test('projects contributor centers with transformed width/height floor semantics', () => {
    const contributors = collectBuildZoneContributors([
      {
        x: 12,
        y: 24,
        width: 4,
        height: 3,
        hp: 2,
      },
      {
        x: 40,
        y: 12,
        width: 3,
        height: 2,
        hp: 0,
      },
    ]);

    expect(contributors).toEqual([
      {
        centerX: 14,
        centerY: 25,
      },
    ]);
  });

  test('treats radius boundary as inclusive for contributor coverage', () => {
    const [contributor] = collectBuildZoneContributors([
      {
        x: 20,
        y: 20,
        width: 1,
        height: 1,
      },
    ]);
    expect(contributor).toBeDefined();
    if (!contributor) {
      throw new Error('Expected contributor to be projected');
    }

    expect(
      isBuildZoneCoveredByContributor(contributor, 20 + BUILD_ZONE_RADIUS, 20),
    ).toBe(true);
    expect(
      isBuildZoneCoveredByContributor(
        contributor,
        20 + BUILD_ZONE_RADIUS + 1,
        20,
      ),
    ).toBe(false);
  });

  test('applies multi-contributor union when collecting illegal cells', () => {
    const contributors = collectBuildZoneContributors([
      {
        x: 0,
        y: 0,
        width: 1,
        height: 1,
      },
      {
        x: 30,
        y: 0,
        width: 1,
        height: 1,
      },
    ]);

    const areaCells: Cell[] = [
      { x: 2, y: 0 },
      { x: 15, y: 0 },
      { x: 44, y: 0 },
      { x: 47, y: 0 },
    ];
    const illegalCells = collectIllegalBuildZoneCells(areaCells, contributors);

    expect(illegalCells).toEqual([{ x: 47, y: 0 }]);
  });

  test('shrinks legal coverage after contributor removal', () => {
    const contributors = collectBuildZoneContributors([
      {
        x: 0,
        y: 0,
        width: 1,
        height: 1,
      },
      {
        x: 30,
        y: 0,
        width: 1,
        height: 1,
      },
    ]);

    const areaCells: Cell[] = [{ x: 30, y: 0 }];
    expect(collectIllegalBuildZoneCells(areaCells, contributors)).toEqual([]);
    const [firstContributor] = contributors;
    expect(firstContributor).toBeDefined();
    if (!firstContributor) {
      throw new Error('Expected at least one contributor');
    }
    expect(collectIllegalBuildZoneCells(areaCells, [firstContributor])).toEqual(
      [{ x: 30, y: 0 }],
    );
  });
});
