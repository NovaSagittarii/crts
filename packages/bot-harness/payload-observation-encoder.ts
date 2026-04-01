/**
 * Observation encoder that operates on RoomStatePayload wire data.
 *
 * Produces the identical channel layout and scalar normalization as
 * ObservationEncoder but without requiring an RtsRoom instance. This
 * is used by the live bot client which receives RoomStatePayload over
 * the socket and needs to encode observations for model inference.
 *
 * Channel layout (channel-first, index = c * H * W + y * W + x):
 *   0: alive cells
 *   1: own structure footprint
 *   2: enemy structure footprint
 *   3: own territory mask (build zone)
 *   4: own core position
 *
 * Scalar layout (normalized to [0, 1]):
 *   0: resources / 500
 *   1: income / 20
 *   2: pending build count / 10
 *   3: non-core structure count / 50
 *   4: core HP / 500
 *   5: tick / maxTicks
 *   6: territory radius / 100
 */
import { Grid } from '#conway-core';
import type {
  BuildZoneContributor,
  BuildZoneContributorProjectionInput,
  RoomStatePayload,
  StructurePayload,
  TeamPayload,
} from '#rts-engine';
import {
  DEFAULT_TEAM_TERRITORY_RADIUS,
  collectBuildZoneContributors,
  isBuildZoneCoveredByContributor,
} from '#rts-engine';

import type { ObservationResult } from './observation-encoder.js';

const NUM_CHANNELS = 5;
const NUM_SCALARS = 7;

/**
 * Encodes observations from RoomStatePayload (socket wire data) without
 * requiring an RtsRoom instance. Produces output identical to
 * ObservationEncoder for the same underlying state.
 */
export class PayloadObservationEncoder {
  private readonly width: number;
  private readonly height: number;
  private readonly planeSize: number;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.planeSize = width * height;
  }

  /**
   * Encode an observation from a RoomStatePayload.
   *
   * @param payload - Wire payload received from the server
   * @param teamId - The team to encode the observation for
   * @param maxTicks - Maximum ticks for the match (for tick normalization)
   * @returns ObservationResult with planes and scalars
   */
  public encode(
    payload: RoomStatePayload,
    teamId: number,
    maxTicks: number,
  ): ObservationResult {
    const planes = new Float32Array(NUM_CHANNELS * this.planeSize);
    const scalars = new Float32Array(NUM_SCALARS);

    const ownTeam = payload.teams.find((t) => t.id === teamId);
    if (!ownTeam) {
      throw new Error(`Team ${String(teamId)} not found in room state`);
    }
    const enemyTeam = payload.teams.find((t) => t.id !== teamId);

    // -- Channel 0: alive cells from bit-packed grid --
    this.encodeAliveCells(payload.grid, planes);

    // -- Channel 1: own structure footprint --
    this.encodeStructureFootprint(ownTeam.structures, planes, 1);

    // -- Channel 2: enemy structure footprint --
    if (enemyTeam) {
      this.encodeStructureFootprint(enemyTeam.structures, planes, 2);
    }

    // -- Channel 3: own territory mask --
    this.encodeTerritoryMask(ownTeam.structures, planes);

    // -- Channel 4: own core position --
    this.encodeCorePosition(ownTeam.structures, planes);

    // -- Scalars --
    this.encodeScalars(ownTeam, payload.tick, maxTicks, scalars);

    return {
      planes,
      scalars,
      shape: {
        channels: NUM_CHANNELS,
        height: this.height,
        width: this.width,
        scalarCount: NUM_SCALARS,
      },
    };
  }

  private encodeAliveCells(
    gridBuffer: ArrayBuffer,
    planes: Float32Array,
  ): void {
    const grid = Grid.fromPacked(
      new Uint8Array(gridBuffer),
      this.width,
      this.height,
    );

    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        if (grid.isCellAlive(x, y)) {
          planes[0 * this.planeSize + y * this.width + x] = 1.0;
        }
      }
    }
  }

  private encodeStructureFootprint(
    structures: StructurePayload[],
    planes: Float32Array,
    channel: number,
  ): void {
    const offset = channel * this.planeSize;
    for (const structure of structures) {
      for (const cell of structure.footprint) {
        if (
          cell.x >= 0 &&
          cell.x < this.width &&
          cell.y >= 0 &&
          cell.y < this.height
        ) {
          planes[offset + cell.y * this.width + cell.x] = 1.0;
        }
      }
    }
  }

  private encodeTerritoryMask(
    ownStructures: StructurePayload[],
    planes: Float32Array,
  ): void {
    const offset = 3 * this.planeSize;

    const inputs: BuildZoneContributorProjectionInput[] = [];
    for (const s of ownStructures) {
      if (s.buildRadius > 0) {
        inputs.push({
          x: s.x,
          y: s.y,
          width: s.width,
          height: s.height,
          buildRadius: s.buildRadius,
        });
      }
    }

    const contributors: BuildZoneContributor[] =
      collectBuildZoneContributors(inputs);
    if (contributors.length === 0) {
      return;
    }

    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        for (const contributor of contributors) {
          if (isBuildZoneCoveredByContributor(contributor, x, y)) {
            planes[offset + y * this.width + x] = 1.0;
            break;
          }
        }
      }
    }
  }

  private encodeCorePosition(
    ownStructures: StructurePayload[],
    planes: Float32Array,
  ): void {
    const offset = 4 * this.planeSize;
    for (const structure of ownStructures) {
      if (structure.isCore) {
        for (const cell of structure.footprint) {
          if (
            cell.x >= 0 &&
            cell.x < this.width &&
            cell.y >= 0 &&
            cell.y < this.height
          ) {
            planes[offset + cell.y * this.width + cell.x] = 1.0;
          }
        }
        break; // Only one core per team
      }
    }
  }

  private encodeScalars(
    ownTeam: TeamPayload,
    tick: number,
    maxTicks: number,
    scalars: Float32Array,
  ): void {
    // 0: resources / 500
    scalars[0] = Math.min(ownTeam.resources / 500, 1.0);

    // 1: income / 20
    scalars[1] = Math.min(ownTeam.income / 20, 1.0);

    // 2: pending build count / 10
    scalars[2] = Math.min(ownTeam.pendingBuilds.length / 10, 1.0);

    // 3: non-core structure count / 50
    const nonCoreCount = ownTeam.structures.filter((s) => !s.isCore).length;
    scalars[3] = Math.min(nonCoreCount / 50, 1.0);

    // 4: core HP / 500
    const coreStructure = ownTeam.structures.find((s) => s.isCore);
    const coreHp = coreStructure ? coreStructure.hp : 0;
    scalars[4] = Math.min(coreHp / 500, 1.0);

    // 5: tick / maxTicks
    scalars[5] = Math.min(tick / maxTicks, 1.0);

    // 6: territory radius / 100
    // Compute the same way as RtsRoom: DEFAULT_TEAM_TERRITORY_RADIUS + sum of
    // buildRadius for active non-core structures with buildRadius > 0
    let territoryRadius = DEFAULT_TEAM_TERRITORY_RADIUS;
    for (const s of ownTeam.structures) {
      if (!s.isCore && s.buildRadius > 0) {
        territoryRadius += s.buildRadius;
      }
    }
    scalars[6] = Math.min(territoryRadius / 100, 1.0);
  }
}
