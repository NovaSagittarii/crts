export interface StructureGridVisibleBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export interface StructureOverlayStructure {
  key: string;
  x: number;
  y: number;
  width: number;
  height: number;
  hp: number;
  templateName: string;
  templateId?: string;
}

export interface StructureGridOverlayInput {
  structures: readonly StructureOverlayStructure[];
  hoveredStructureKey: string | null;
  maxHpByTemplateId: Readonly<Record<string, number>>;
  visibleBounds: StructureGridVisibleBounds | null;
}

export interface StructureGridOverlayItem {
  key: string;
  x: number;
  y: number;
  width: number;
  height: number;
  hp: number;
  templateName: string;
  integrityRatio: number | null;
  showLabel: boolean;
}

export interface StructureIntegrityRenderInput {
  integrityRatio: number | null;
  hp: number;
}

function clampRatio(value: number): number {
  return Math.max(0, Math.min(value, 1));
}

function normalizeKey(key: string | null | undefined): string | null {
  if (typeof key !== 'string') {
    return null;
  }
  const normalized = key.trim();
  return normalized.length > 0 ? normalized : null;
}

export class StructureGridOverlayModel {
  public static deriveOverlayItems(
    input: StructureGridOverlayInput,
  ): StructureGridOverlayItem[] {
    const hoveredKey = normalizeKey(input.hoveredStructureKey);

    return input.structures
      .filter((structure) =>
        StructureGridOverlayModel.intersectsVisibleBounds(
          structure,
          input.visibleBounds,
        ),
      )
      .map((structure) => ({
        key: structure.key,
        x: structure.x,
        y: structure.y,
        width: structure.width,
        height: structure.height,
        hp: structure.hp,
        templateName: structure.templateName,
        integrityRatio: StructureGridOverlayModel.deriveIntegrityRatio(
          structure,
          input.maxHpByTemplateId,
        ),
        showLabel: hoveredKey === structure.key,
      }));
  }

  public static intersectsVisibleBounds(
    structure: StructureOverlayStructure,
    visibleBounds: StructureGridVisibleBounds | null,
  ): boolean {
    if (visibleBounds === null) {
      return true;
    }

    const structureMinX = structure.x;
    const structureMaxX = structure.x + structure.width - 1;
    const structureMinY = structure.y;
    const structureMaxY = structure.y + structure.height - 1;

    return (
      structureMinX <= visibleBounds.maxX &&
      structureMaxX >= visibleBounds.minX &&
      structureMinY <= visibleBounds.maxY &&
      structureMaxY >= visibleBounds.minY
    );
  }

  public static deriveIntegrityRatio(
    structure: StructureOverlayStructure,
    maxHpByTemplateId: Readonly<Record<string, number>>,
  ): number | null {
    const templateId = normalizeKey(structure.templateId);
    if (templateId === null) {
      return null;
    }

    const templateMaxHp = maxHpByTemplateId[templateId];
    if (!Number.isFinite(templateMaxHp) || templateMaxHp <= 0) {
      return null;
    }

    return clampRatio(structure.hp / templateMaxHp);
  }

  public static deriveRenderIntegrityRatio(
    input: StructureIntegrityRenderInput,
  ): number {
    if (input.integrityRatio !== null) {
      return clampRatio(input.integrityRatio);
    }

    return input.hp > 0 ? 1 : 0;
  }
}
