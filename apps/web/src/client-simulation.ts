import { Grid } from '#conway-core';
import {
  type BuildEvent,
  type DestroyEvent,
  type RoomDeterminismCheckpoint,
  type RoomState,
  type RoomStatePayload,
  RtsRoom,
  StructureTemplate,
  type StructureTemplatePayload,
} from '#rts-engine';
import type { BuildQueuedPayload, DestroyQueuedPayload } from '#rts-engine';

/**
 * Converts a wire-format `StructureTemplatePayload` into a `StructureTemplate`
 * instance suitable for `RtsRoom.fromPayload()`.
 */
export function templateFromPayload(
  payload: StructureTemplatePayload,
): StructureTemplate {
  const aliveCells: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < payload.cells.length; i++) {
    if (payload.cells[i] === 1) {
      aliveCells.push({
        x: i % payload.width,
        y: Math.floor(i / payload.width),
      });
    }
  }
  const grid = new Grid(payload.width, payload.height, aliveCells, 'flat');
  return StructureTemplate.from({
    id: payload.id,
    name: payload.name,
    activationCost: payload.activationCost,
    income: payload.income,
    buildRadius: payload.buildRadius,
    startingHp: payload.startingHp,
    checks: payload.checks,
    grid,
  });
}

export type ClientSimulationStatus = 'idle' | 'initialized' | 'running';

/**
 * Manages a local `RtsRoom` on the client for deterministic lockstep.
 *
 * This is a pure TypeScript class with no DOM or Socket.IO dependencies.
 * Socket event wiring happens in client.ts. The class owns:
 *
 * - Lifecycle (idle -> initialized -> running -> idle)
 * - Server-driven tick advance (no setInterval)
 * - Input replay (build:queued / destroy:queued)
 * - Hash-based checkpoint verification
 */
export class ClientSimulation {
  private rtsRoom: RtsRoom | null = null;
  private _currentTick: number = 0;
  private _status: ClientSimulationStatus = 'idle';

  // --- Lifecycle accessors ---

  get status(): ClientSimulationStatus {
    return this._status;
  }

  get isActive(): boolean {
    return this._status !== 'idle';
  }

  get currentTick(): number {
    return this._currentTick;
  }

  get currentState(): RoomState | null {
    return this.rtsRoom?.state ?? null;
  }

  // --- Lifecycle ---

  initialize(payload: RoomStatePayload, templates: StructureTemplate[]): void {
    this.rtsRoom = RtsRoom.fromPayload(payload, templates);
    this._currentTick = payload.tick;
    this._status = 'initialized';
  }

  // --- Tick Advance (server-driven, SIM-02) ---

  advanceToTick(targetTick: number): void {
    if (!this.rtsRoom || targetTick <= this._currentTick) {
      return;
    }

    while (this._currentTick < targetTick) {
      this.rtsRoom.tick();
      this._currentTick = this.rtsRoom.state.tick;
    }

    if (this._status === 'initialized') {
      this._status = 'running';
    }
  }

  // --- Input Replay ---

  applyQueuedBuild(payload: BuildQueuedPayload): void {
    if (!this.rtsRoom) {
      return;
    }

    const team = this.rtsRoom.state.teams.get(payload.teamId);
    if (!team) {
      console.warn(
        `[ClientSimulation] applyQueuedBuild: team ${String(payload.teamId)} not found`,
      );
      return;
    }

    const template = this.rtsRoom.state.templateMap.get(payload.templateId);

    const buildEvent: BuildEvent = {
      id: payload.eventId,
      teamId: payload.teamId,
      playerId: payload.playerId,
      templateId: payload.templateId,
      x: payload.x,
      y: payload.y,
      transform: payload.transform,
      executeTick: payload.executeTick,
      reservedCost: template?.activationCost ?? 0,
    };

    team.pendingBuildEvents.push(buildEvent);
    team.resources -= buildEvent.reservedCost;
  }

  applyQueuedDestroy(payload: DestroyQueuedPayload): void {
    if (!this.rtsRoom) {
      return;
    }

    const team = this.rtsRoom.state.teams.get(payload.teamId);
    if (!team) {
      console.warn(
        `[ClientSimulation] applyQueuedDestroy: team ${String(payload.teamId)} not found`,
      );
      return;
    }

    if (payload.idempotent) {
      const existing = team.pendingDestroyEvents.find(
        (e) => e.id === payload.eventId,
      );
      if (existing) {
        return;
      }
    }

    const destroyEvent: DestroyEvent = {
      id: payload.eventId,
      teamId: payload.teamId,
      playerId: payload.playerId,
      structureKey: payload.structureKey,
      executeTick: payload.executeTick,
    };

    team.pendingDestroyEvents.push(destroyEvent);
  }

  // --- Verification ---

  verifyCheckpoint(serverCheckpoint: RoomDeterminismCheckpoint): boolean {
    if (!this.rtsRoom) {
      return false;
    }

    const local = this.rtsRoom.createDeterminismCheckpoint();
    return local.hashHex === serverCheckpoint.hashHex;
  }

  createLocalCheckpoint(): RoomDeterminismCheckpoint | null {
    if (!this.rtsRoom) {
      return null;
    }

    return this.rtsRoom.createDeterminismCheckpoint();
  }

  // --- Resync ---

  resync(payload: RoomStatePayload, templates: StructureTemplate[]): void {
    this.destroy();
    this.initialize(payload, templates);
  }

  // --- Cleanup ---

  destroy(): void {
    this.rtsRoom = null;
    this._currentTick = 0;
    this._status = 'idle';
  }
}
