import type { Grid } from '#conway-core';
import type {
  BuildQueuePayload,
  DestroyQueuePayload,
  PendingBuildPayload,
  PendingDestroyPayload,
  StructurePayload,
  StructureTemplateSummary,
  TeamIncomeBreakdown,
  Vector2,
} from '#rts-engine';

export interface TeamStateView {
  id: number;
  resources: number;
  income: number;
  incomeBreakdown: TeamIncomeBreakdown;
  structures: StructurePayload[];
  pendingBuilds: PendingBuildPayload[];
  pendingDestroys: PendingDestroyPayload[];
  defeated: boolean;
  baseTopLeft: Vector2;
}

export interface BotView {
  tick: number;
  grid: Grid;
  teamState: TeamStateView;
  templates: StructureTemplateSummary[];
  roomWidth: number;
  roomHeight: number;
}

export interface BotAction {
  type: 'build' | 'destroy';
  build?: BuildQueuePayload;
  destroy?: DestroyQueuePayload;
}

export interface BotStrategy {
  readonly name: string;
  decideTick(view: BotView, teamId: number): BotAction[];
}
