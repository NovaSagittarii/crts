import { describe, expect, test } from 'vitest';

import {
  collectBuildZoneContributors,
  collectCoveredBuildZoneCells,
  collectIllegalBuildZoneCells,
  isBuildZoneCoveredByContributor,
} from './build-zone.js';
import { BUILD_ZONE_RADIUS } from './gameplay-rules.js';

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

  test('ignores contributors with invalid width or height', () => {
    const contributors = collectBuildZoneContributors([
      {
        x: 2,
        y: 4,
        width: 2,
        height: 2,
      },
      {
        x: 8,
        y: 10,
        width: 0,
        height: 3,
      },
      {
        x: 12,
        y: 16,
        width: 3,
        height: -1,
      },
    ]);

    expect(contributors).toEqual([
      {
        centerX: 3,
        centerY: 5,
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

    expect(illegalCells).toEqual([
      { x: 15, y: 0 },
      { x: 47, y: 0 },
    ]);
  });

  test('treats every cell as illegal when no contributors are present', () => {
    const areaCells: Cell[] = [
      { x: 2, y: 0 },
      { x: 15, y: 0 },
    ];

    expect(collectIllegalBuildZoneCells(areaCells, [])).toEqual(areaCells);
    expect(collectCoveredBuildZoneCells(areaCells, [])).toEqual([]);
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

  test('collects covered cells in input order across multiple contributors', () => {
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
      { x: 30, y: 0 },
      { x: 15, y: 0 },
      { x: 2, y: 0 },
      { x: 44, y: 0 },
      { x: 47, y: 0 },
    ];

    expect(collectCoveredBuildZoneCells(areaCells, contributors)).toEqual([
      { x: 30, y: 0 },
      { x: 2, y: 0 },
      { x: 44, y: 0 },
    ]);
  });
});
