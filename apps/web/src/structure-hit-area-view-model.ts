export interface StructureHitAreaCell {
  x: number;
  y: number;
}

export interface StructureHitAreaStructure {
  key: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

function toCellKey(cell: StructureHitAreaCell): string {
  return `${cell.x},${cell.y}`;
}

function hasValidDimensions(structure: StructureHitAreaStructure): boolean {
  return structure.width > 0 && structure.height > 0;
}

export class StructureHitAreaModel {
  public static buildCellIndex<T extends StructureHitAreaStructure>(
    structures: readonly T[],
  ): Map<string, T> {
    const index = new Map<string, T>();
    for (const structure of structures) {
      StructureHitAreaModel.indexStructure(index, structure);
    }
    return index;
  }

  public static getStructureAtCell<T extends StructureHitAreaStructure>(
    cell: StructureHitAreaCell,
    index: ReadonlyMap<string, T>,
  ): T | null {
    return index.get(toCellKey(cell)) ?? null;
  }

  private static indexStructure<T extends StructureHitAreaStructure>(
    index: Map<string, T>,
    structure: T,
  ): void {
    if (!hasValidDimensions(structure)) {
      return;
    }

    const maxX = structure.x + structure.width;
    const maxY = structure.y + structure.height;
    for (let y = structure.y; y < maxY; y += 1) {
      for (let x = structure.x; x < maxX; x += 1) {
        const key = toCellKey({ x, y });
        if (!index.has(key)) {
          index.set(key, structure);
        }
      }
    }
  }
}
