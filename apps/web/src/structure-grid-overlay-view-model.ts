import type { VisibleGridBounds } from './render-viewport.js';

export type StructureGridVisibleBounds = VisibleGridBounds;

export interface StructureOverlayStructure {
  key: string;
  x: number;
  y: number;
  width: number;
  height: number;
  hp: number;
  startingHp?: number;
  templateName: string;
  templateId?: string;
}

export interface StructureGridOverlayInput {
  structures: readonly StructureOverlayStructure[];
  hoveredStructureKey: string | null;
  pinnedStructureKey: string | null;
  maxHpByTemplateId: Readonly<Record<string, number>>;
  visibleBounds: StructureGridVisibleBounds | null;
}

export type StructureOverlayInteractionState = 'idle' | 'hovered' | 'pinned';

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
  interactionState: StructureOverlayInteractionState;
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

function normalizeMaxHp(value: number | null | undefined): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return null;
  }
  return value;
}

export class StructureGridOverlayModel {
  public static deriveOverlayItems(
    input: StructureGridOverlayInput,
  ): StructureGridOverlayItem[] {
    const hoveredKey = normalizeKey(input.hoveredStructureKey);
    const pinnedKey = normalizeKey(input.pinnedStructureKey);

    return input.structures
      .filter((structure) =>
        StructureGridOverlayModel.intersectsVisibleBounds(
          structure,
          input.visibleBounds,
        ),
      )
      .map((structure) => {
        const interactionState: StructureOverlayInteractionState =
          pinnedKey === structure.key
            ? 'pinned'
            : hoveredKey === structure.key
              ? 'hovered'
              : 'idle';

        return {
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
          interactionState,
        };
      });
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
    if (templateId !== null) {
      const templateMaxHp = normalizeMaxHp(maxHpByTemplateId[templateId]);
      if (templateMaxHp !== null) {
        return clampRatio(structure.hp / templateMaxHp);
      }
    }

    const structureStartingHp = normalizeMaxHp(structure.startingHp);
    if (structureStartingHp !== null) {
      return clampRatio(structure.hp / structureStartingHp);
    }

    return null;
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
