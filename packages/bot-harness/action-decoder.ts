import type {
  BuildQueuePayload,
  StructureTemplateSummary,
  Vector2,
} from '#rts-engine';
import {
  RtsRoom,
  CORE_TEMPLATE_ID,
  collectBuildZoneContributors,
  isBuildZoneCoveredByContributor,
} from '#rts-engine';
import type { BuildZoneContributorProjectionInput } from '#rts-engine';

/**
 * Descriptor for the discrete action space layout, consumed by PPO network
 * builders in Phase 20.
 */
export interface ActionSpaceInfo {
  /** Gymnasium-style space type */
  type: 'Discrete';
  /** Total action count: numTemplates * numPositions + 1 (includes no-op at index 0) */
  n: number;
  /** Number of buildable templates (excluding __core__) */
  numTemplates: number;
  /** Position space upper bound: width * height (full grid) */
  numPositions: number;
  /** Ordered template IDs for deterministic index mapping */
  templateIds: readonly string[];
}

/**
 * Maps discrete action indices to BuildQueuePayload objects with
 * territory-bounded enumeration and exhaustive action masking via
 * RtsRoom.previewBuildPlacement.
 *
 * Action space layout:
 *   index 0            -> no-op
 *   index 1..N         -> build actions
 *   actionIdx = templateIdx * (width * height) + posIdx + 1
 *   where posIdx = y * width + x (row-major)
 */
export class ActionDecoder {
  private readonly width: number;
  private readonly height: number;
  /** Cached sorted template list -- lazily populated per room */
  private cachedTemplates: StructureTemplateSummary[] | null = null;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
  }

  /**
   * Returns buildable templates sorted alphabetically by id, excluding __core__.
   */
  public getBuildableTemplates(room: RtsRoom): StructureTemplateSummary[] {
    if (this.cachedTemplates) {
      return this.cachedTemplates;
    }
    const templates = room.state.templates
      .filter((t) => t.id !== CORE_TEMPLATE_ID)
      .map((t) => t.toSummary())
      .sort((a, b) => a.id.localeCompare(b.id));
    this.cachedTemplates = templates;
    return templates;
  }

  /**
   * Enumerates all grid cells within the build zone of the given team's
   * structures, returned in row-major order (y ascending, then x ascending).
   */
  public enumerateTerritoryPositions(room: RtsRoom, teamId: number): Vector2[] {
    const payload = room.createStatePayload();
    const teamPayload = payload.teams.find((t) => t.id === teamId);
    if (!teamPayload) {
      return [];
    }

    // Collect build zone contributors from all own structures with buildRadius > 0
    const inputs: BuildZoneContributorProjectionInput[] = teamPayload.structures
      .filter((s) => s.buildRadius > 0)
      .map((s) => ({
        x: s.x,
        y: s.y,
        width: s.width,
        height: s.height,
        buildRadius: s.buildRadius,
      }));

    const contributors = collectBuildZoneContributors(inputs);

    if (contributors.length === 0) {
      return [];
    }

    // Iterate full grid in row-major order
    const positions: Vector2[] = [];
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        for (const contributor of contributors) {
          if (isBuildZoneCoveredByContributor(contributor, x, y)) {
            positions.push({ x, y });
            break;
          }
        }
      }
    }

    return positions;
  }

  /**
   * Computes a per-action validity mask.
   * mask[0] = 1 (no-op always valid).
   * mask[i] = 1 iff previewBuildPlacement accepts the decoded payload.
   *
   * Uses playerId (string), NOT teamId, per RtsRoom API contract.
   */
  public computeActionMask(
    room: RtsRoom,
    playerId: string,
    teamId: number,
  ): Uint8Array {
    const templates = this.getBuildableTemplates(room);
    const numPositions = this.width * this.height;
    const maskSize = templates.length * numPositions + 1;
    const mask = new Uint8Array(maskSize);

    // No-op always valid
    mask[0] = 1;

    // Get territory positions (only iterate these for efficiency)
    const territoryPositions = this.enumerateTerritoryPositions(room, teamId);

    for (const pos of territoryPositions) {
      const posIdx = pos.y * this.width + pos.x;

      for (let templateIdx = 0; templateIdx < templates.length; templateIdx++) {
        const template = templates[templateIdx];
        const actionIdx = templateIdx * numPositions + posIdx + 1;

        const preview = room.previewBuildPlacement(playerId, {
          templateId: template.id,
          x: pos.x,
          y: pos.y,
        });

        mask[actionIdx] = preview.accepted ? 1 : 0;
      }
    }

    return mask;
  }

  /**
   * Decodes an action index back to a BuildQueuePayload.
   * Returns null for index 0 (no-op).
   */
  public decode(actionIndex: number): BuildQueuePayload | null {
    if (actionIndex === 0) {
      return null;
    }

    const adjusted = actionIndex - 1;
    const numPositions = this.width * this.height;
    const templateIdx = Math.floor(adjusted / numPositions);
    const posIdx = adjusted % numPositions;
    const x = posIdx % this.width;
    const y = Math.floor(posIdx / this.width);

    // Template ID lookup requires the sorted template list.
    // For decode-only calls (without a room), we use the canonical
    // alphabetical ordering of the 5 default templates.
    const templateIds = this.cachedTemplates
      ? this.cachedTemplates.map((t) => t.id)
      : ['block', 'eater-1', 'generator', 'glider', 'gosper'];

    if (templateIdx < 0 || templateIdx >= templateIds.length) {
      return null;
    }

    return {
      templateId: templateIds[templateIdx],
      x,
      y,
    };
  }

  /**
   * Returns static shape descriptor for the action space, consumed by
   * Phase 20's PPO network builder.
   */
  public getActionSpaceInfo(room: RtsRoom): ActionSpaceInfo {
    const templates = this.getBuildableTemplates(room);
    const numPositions = this.width * this.height;

    return {
      type: 'Discrete',
      n: templates.length * numPositions + 1,
      numTemplates: templates.length,
      numPositions,
      templateIds: templates.map((t) => t.id),
    };
  }
}
