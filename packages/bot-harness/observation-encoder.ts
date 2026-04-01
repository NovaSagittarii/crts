import type {
  BuildZoneContributor,
  BuildZoneContributorProjectionInput,
  RoomStatePayload,
  RtsRoom,
  StructurePayload,
  TeamPayload,
} from '#rts-engine';
import {
  collectBuildZoneContributors,
  isBuildZoneCoveredByContributor,
} from '#rts-engine';

/**
 * Result of encoding an RtsRoom observation for a single team.
 *
 * - `planes`: C * H * W flat Float32Array in channel-first layout [C, H, W].
 * - `scalars`: 7 normalized scalar features in [0, 1].
 * - `shape`: metadata describing the array dimensions.
 */
export interface ObservationResult {
  planes: Float32Array;
  scalars: Float32Array;
  shape: {
    channels: number;
    height: number;
    width: number;
    scalarCount: number;
  };
}

const NUM_CHANNELS = 5;
const NUM_SCALARS = 7;

/**
 * Deterministic observation encoder that produces multi-channel feature planes
 * and normalized scalar features from an RtsRoom state for a given team.
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
export class ObservationEncoder {
  private readonly width: number;
  private readonly height: number;
  private readonly planeSize: number;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.planeSize = width * height;
  }

  public encode(
    room: RtsRoom,
    teamId: number,
    tick: number,
    maxTicks: number,
  ): ObservationResult {
    const planes = new Float32Array(NUM_CHANNELS * this.planeSize);
    const scalars = new Float32Array(NUM_SCALARS);

    const payload: RoomStatePayload = room.createStatePayload();
    const ownTeam = payload.teams.find((t) => t.id === teamId);
    if (!ownTeam) {
      throw new Error(`Team ${String(teamId)} not found in room state`);
    }
    const enemyTeam = payload.teams.find((t) => t.id !== teamId);

    // -- Channel 0: alive cells --
    this.encodeAliveCells(room, planes);

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
    this.encodeScalars(room, ownTeam, tick, maxTicks, teamId, scalars);

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

  private encodeAliveCells(room: RtsRoom, planes: Float32Array): void {
    const grid = room.state.grid;
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
    // Structures from payload are already sorted by key
    for (const structure of structures) {
      for (const cell of structure.footprint) {
        if (cell.x >= 0 && cell.x < this.width && cell.y >= 0 && cell.y < this.height) {
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

    // Build contributor projection inputs from structures with buildRadius > 0
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

    const contributors: BuildZoneContributor[] = collectBuildZoneContributors(inputs);
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
          if (cell.x >= 0 && cell.x < this.width && cell.y >= 0 && cell.y < this.height) {
            planes[offset + cell.y * this.width + cell.x] = 1.0;
          }
        }
        break; // Only one core per team
      }
    }
  }

  private encodeScalars(
    room: RtsRoom,
    ownTeam: TeamPayload,
    tick: number,
    maxTicks: number,
    teamId: number,
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
    // TeamPayload doesn't expose territoryRadius, so read from RoomState directly
    const teamState = room.state.teams.get(teamId);
    const territoryRadius = teamState ? teamState.territoryRadius : 0;
    scalars[6] = Math.min(territoryRadius / 100, 1.0);
  }
}
