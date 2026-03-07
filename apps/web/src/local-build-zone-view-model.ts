import {
  BUILD_ZONE_RADIUS,
  isBuildZoneCoveredByContributor,
  projectBuildZoneContributor,
} from '#rts-engine';

export interface LocalBuildZoneStructureSnapshot {
  key: string;
  x: number;
  y: number;
  width: number;
  height: number;
  hp: number;
}

export interface ComputeLocalBuildZoneOverlayInput {
  structures: readonly LocalBuildZoneStructureSnapshot[];
  gridWidth: number;
  gridHeight: number;
  previousSignature: string;
  coverageCache: Map<string, readonly number[]>;
  maxCoverageCacheEntries: number;
}

export interface ComputeLocalBuildZoneOverlayResult {
  signature: string;
  changed: boolean;
  cellKeys: number[];
}

function toCellKey(x: number, y: number, gridWidth: number): number {
  return y * gridWidth + x;
}

function sortStructuresByKey(
  structures: readonly LocalBuildZoneStructureSnapshot[],
): LocalBuildZoneStructureSnapshot[] {
  return [...structures].sort((left, right) =>
    left.key.localeCompare(right.key),
  );
}

function buildSignatureFromSortedStructures(
  structures: readonly LocalBuildZoneStructureSnapshot[],
): string {
  return structures
    .map(
      (structure) =>
        `${structure.key}:${structure.x},${structure.y},${structure.width},${structure.height},${structure.hp}`,
    )
    .join('|');
}

function buildCoverageCacheKey(
  structure: LocalBuildZoneStructureSnapshot,
  gridWidth: number,
  gridHeight: number,
): string {
  return `${gridWidth}x${gridHeight}:${structure.x},${structure.y},${structure.width},${structure.height},${structure.hp}`;
}

function deriveStructureCoverageCellKeys(
  structure: LocalBuildZoneStructureSnapshot,
  gridWidth: number,
  gridHeight: number,
): number[] {
  if (structure.hp <= 0 || structure.width <= 0 || structure.height <= 0) {
    return [];
  }

  const contributor = projectBuildZoneContributor({
    x: structure.x,
    y: structure.y,
    width: structure.width,
    height: structure.height,
    hp: structure.hp,
  });

  const minX = Math.max(0, Math.ceil(contributor.centerX - BUILD_ZONE_RADIUS));
  const maxX = Math.min(
    gridWidth - 1,
    Math.floor(contributor.centerX + BUILD_ZONE_RADIUS),
  );
  const minY = Math.max(0, Math.ceil(contributor.centerY - BUILD_ZONE_RADIUS));
  const maxY = Math.min(
    gridHeight - 1,
    Math.floor(contributor.centerY + BUILD_ZONE_RADIUS),
  );

  const coverageCellKeys: number[] = [];
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      if (!isBuildZoneCoveredByContributor(contributor, x, y)) {
        continue;
      }
      coverageCellKeys.push(toCellKey(x, y, gridWidth));
    }
  }

  return coverageCellKeys;
}

export function computeLocalBuildZoneSignature(
  structures: readonly LocalBuildZoneStructureSnapshot[],
): string {
  return buildSignatureFromSortedStructures(sortStructuresByKey(structures));
}

export function computeLocalBuildZoneOverlay(
  input: ComputeLocalBuildZoneOverlayInput,
): ComputeLocalBuildZoneOverlayResult {
  if (input.gridWidth <= 0 || input.gridHeight <= 0) {
    return {
      signature: '',
      changed: input.previousSignature !== '',
      cellKeys: [],
    };
  }

  const sortedStructures = sortStructuresByKey(input.structures);
  const signature = buildSignatureFromSortedStructures(sortedStructures);

  if (signature === input.previousSignature) {
    return {
      signature,
      changed: false,
      cellKeys: [],
    };
  }

  const cacheLimit = Math.max(0, Math.floor(input.maxCoverageCacheEntries));
  const coveredCellKeys = new Set<number>();

  for (const structure of sortedStructures) {
    const cacheKey = buildCoverageCacheKey(
      structure,
      input.gridWidth,
      input.gridHeight,
    );
    let structureCoverage =
      cacheLimit > 0 ? input.coverageCache.get(cacheKey) : undefined;

    if (!structureCoverage) {
      structureCoverage = deriveStructureCoverageCellKeys(
        structure,
        input.gridWidth,
        input.gridHeight,
      );
      if (cacheLimit > 0) {
        if (input.coverageCache.size >= cacheLimit) {
          input.coverageCache.clear();
        }
        input.coverageCache.set(cacheKey, structureCoverage);
      }
    }

    for (const key of structureCoverage) {
      coveredCellKeys.add(key);
    }
  }

  return {
    signature,
    changed: true,
    cellKeys: [...coveredCellKeys].sort((left, right) => left - right),
  };
}
