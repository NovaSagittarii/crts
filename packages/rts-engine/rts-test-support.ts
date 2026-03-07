import { Grid } from '#conway-core';

import {
  type BuildOutcome,
  type BuildPreviewResult,
  type BuildQueuePayload,
  type RoomState,
  type RoomTickResult,
  RtsEngine,
  type TeamPayload,
} from './rts.js';
import type { StructurePayload } from './structure.js';

export interface Cell {
  x: number;
  y: number;
}

export function getTeamPayload(
  room: RoomState,
  teamId: number,
): TeamPayload | null {
  return (
    RtsEngine.createRoomStatePayload(room).teams.find(
      (team) => team.id === teamId,
    ) ?? null
  );
}

export function requireTeamPayload(
  room: RoomState,
  teamId: number,
): TeamPayload {
  const teamPayload = getTeamPayload(room, teamId);
  if (!teamPayload) {
    throw new Error(`Expected payload team ${String(teamId)} to exist`);
  }

  return teamPayload;
}

export function getCoreStructure(
  room: RoomState,
  teamId: number,
): StructurePayload | null {
  return (
    getTeamPayload(room, teamId)?.structures.find(
      (structure) => structure.isCore,
    ) ?? null
  );
}

export function getCellAlive(
  grid: ArrayBuffer,
  width: number,
  height: number,
  cell: Cell,
): boolean {
  const unpackedGrid = Grid.fromPacked(grid, width, height, 'flat');
  return unpackedGrid.isCellAlive(cell.x, cell.y);
}

export function getBuildOutcomes(result: RoomTickResult): BuildOutcome[] {
  return result.buildOutcomes;
}

export function probeQueueBuild(
  room: RoomState,
  playerId: string,
  payload: BuildQueuePayload,
): BuildPreviewResult {
  return RtsEngine.previewBuildPlacement(room, playerId, payload);
}

export function getRoomId(room: RoomState): string {
  return room.id;
}

export function getRoomWidth(room: RoomState): number {
  return room.width;
}

export function getRoomHeight(room: RoomState): number {
  return room.height;
}

export function getStructureByTemplateId(
  room: RoomState,
  teamId: number,
  templateId: string,
): StructurePayload | null {
  return (
    getTeamPayload(room, teamId)?.structures.find(
      (candidate) => candidate.templateId === templateId,
    ) ?? null
  );
}

export function countStructuresByTemplateId(
  room: RoomState,
  teamId: number,
  templateId: string,
): number {
  const team = room.teams.get(teamId);
  if (!team) {
    return 0;
  }

  let count = 0;
  for (const structure of team.structures.values()) {
    if (structure.templateId === templateId) {
      count += 1;
    }
  }

  return count;
}

export function createTemplateGrid(
  width: number,
  height: number,
  cells: readonly number[],
): Grid {
  if (cells.length !== width * height) {
    throw new Error('Template test cells must match width and height');
  }

  const aliveCells: Cell[] = [];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (cells[y * width + x] !== 1) {
        continue;
      }

      aliveCells.push({ x, y });
    }
  }

  return new Grid(width, height, aliveCells, 'flat');
}

export function setCellsAlive(
  room: RoomState,
  cells: readonly Cell[],
  alive: number,
): void {
  for (const cell of cells) {
    room.grid.setCell(cell.x, cell.y, alive);
  }
}

export function clearCells(room: RoomState, cells: readonly Cell[]): void {
  setCellsAlive(room, cells, 0);
}
