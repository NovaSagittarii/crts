import type {
  BuildOutcome,
  BuildQueuePayload,
  DestroyOutcome,
  RoomTickResult,
  StructureTemplateSummary,
} from '#rts-engine';
import { RtsRoom } from '#rts-engine';

import type { BotAction, BotStrategy, BotView, TeamStateView } from './bot-strategy.js';
import { seedToRoomId } from './seed.js';
import type {
  MatchCallbacks,
  MatchConfig,
  MatchResult,
  TickActionRecord,
  TickEconomyRecord,
  TickRecord,
} from './types.js';

export function createBotView(
  room: RtsRoom,
  teamId: number,
  tick: number,
): BotView {
  const payload = room.createStatePayload();
  const teamPayload = payload.teams.find((t) => t.id === teamId);
  if (!teamPayload) {
    throw new Error(`Team ${String(teamId)} not found in room state`);
  }

  const teamState: TeamStateView = {
    id: teamPayload.id,
    resources: teamPayload.resources,
    income: teamPayload.income,
    incomeBreakdown: teamPayload.incomeBreakdown,
    structures: teamPayload.structures,
    pendingBuilds: teamPayload.pendingBuilds,
    pendingDestroys: teamPayload.pendingDestroys,
    defeated: teamPayload.defeated,
    baseTopLeft: teamPayload.baseTopLeft,
  };

  const templates: StructureTemplateSummary[] = room.state.templates.map((t) =>
    t.toSummary(),
  );

  return {
    tick,
    grid: room.state.grid,
    teamState,
    templates,
    roomWidth: payload.width,
    roomHeight: payload.height,
  };
}

export function applyBotActions(
  room: RtsRoom,
  playerId: string,
  actions: BotAction[],
): void {
  for (const action of actions) {
    if (action.type === 'build' && action.build) {
      room.queueBuildEvent(playerId, action.build);
    }
    if (action.type === 'destroy' && action.destroy) {
      room.queueDestroyEvent(playerId, action.destroy);
    }
  }
}

function mapBuildOutcomeToActionRecord(
  outcome: BuildOutcome,
  buildPayload?: BuildQueuePayload,
): TickActionRecord {
  const record: TickActionRecord = {
    teamId: outcome.teamId,
    actionType: 'build',
    result: outcome.outcome === 'applied' ? 'applied' : (outcome.reason ?? 'rejected'),
  };
  if (buildPayload) {
    record.templateId = buildPayload.templateId;
    record.x = buildPayload.x;
    record.y = buildPayload.y;
    if (buildPayload.transform !== undefined) {
      record.transform = buildPayload.transform;
    }
  }
  return record;
}

function mapDestroyOutcomeToActionRecord(outcome: DestroyOutcome): TickActionRecord {
  return {
    teamId: outcome.teamId,
    actionType: 'destroy',
    structureKey: outcome.structureKey,
    templateId: outcome.templateId,
    result: outcome.outcome === 'destroyed' ? 'applied' : (outcome.reason ?? 'rejected'),
  };
}

export function createTickRecord(
  tick: number,
  result: RoomTickResult,
  room: RtsRoom,
  botActions: [BotAction[], BotAction[]],
  teamIds: [number, number],
  hashCheckpointInterval: number,
): TickRecord {
  // Build a per-team queue of build payloads from bot actions for correlation
  const buildPayloadsByTeam = new Map<number, BuildQueuePayload[]>();
  for (let i = 0; i < 2; i++) {
    const payloads: BuildQueuePayload[] = [];
    for (const action of botActions[i]) {
      if (action.type === 'build' && action.build) {
        payloads.push(action.build);
      }
    }
    buildPayloadsByTeam.set(teamIds[i], payloads);
  }

  // Track per-team consumption index for positional matching
  const consumedIndexByTeam = new Map<number, number>();

  const buildActions: TickActionRecord[] = result.buildOutcomes.map(
    (outcome) => {
      const teamPayloads = buildPayloadsByTeam.get(outcome.teamId);
      const idx = consumedIndexByTeam.get(outcome.teamId) ?? 0;
      const payload = teamPayloads && idx < teamPayloads.length
        ? teamPayloads[idx]
        : undefined;
      consumedIndexByTeam.set(outcome.teamId, idx + 1);
      return mapBuildOutcomeToActionRecord(outcome, payload);
    },
  );

  const actions: TickActionRecord[] = [
    ...buildActions,
    ...result.destroyOutcomes.map(mapDestroyOutcomeToActionRecord),
  ];

  const statePayload = room.createStatePayload();
  const economy: TickEconomyRecord[] = statePayload.teams.map((team) => ({
    teamId: team.id,
    resources: team.resources,
    income: team.income,
  }));

  const tickRecord: TickRecord = {
    type: 'tick',
    tick,
    actions,
    economy,
    buildOutcomes: result.buildOutcomes.length,
    destroyOutcomes: result.destroyOutcomes.length,
  };

  if (hashCheckpointInterval > 0 && tick % hashCheckpointInterval === 0) {
    const checkpoint = room.createDeterminismCheckpoint();
    tickRecord.hash = checkpoint.hashHex;
  }

  return tickRecord;
}

export function runMatch(
  config: MatchConfig,
  botA: BotStrategy,
  botB: BotStrategy,
  callbacks?: MatchCallbacks,
): MatchResult {
  const roomId = seedToRoomId(config.seed);
  const room = RtsRoom.create({
    id: roomId,
    name: `headless-${roomId}`,
    width: config.gridWidth,
    height: config.gridHeight,
  });

  const teamA = room.addPlayer('bot-a', botA.name);
  const teamB = room.addPlayer('bot-b', botB.name);

  let lastOutcome: RoomTickResult['outcome'] = null;
  let totalTicks = 0;

  for (let tick = 0; tick < config.maxTicks; tick++) {
    const viewA = createBotView(room, teamA.id, tick);
    const viewB = createBotView(room, teamB.id, tick);

    const actionsA = botA.decideTick(viewA, teamA.id);
    const actionsB = botB.decideTick(viewB, teamB.id);

    applyBotActions(room, 'bot-a', actionsA);
    applyBotActions(room, 'bot-b', actionsB);

    const result = room.tick();
    totalTicks = tick + 1;

    const tickRecord = createTickRecord(
      tick,
      result,
      room,
      [actionsA, actionsB],
      [teamA.id, teamB.id],
      config.hashCheckpointInterval,
    );

    callbacks?.onTickComplete?.(tick, tickRecord);

    if (result.outcome !== null) {
      lastOutcome = result.outcome;
      break;
    }
  }

  const matchResult: MatchResult = {
    seed: config.seed,
    config,
    outcome: lastOutcome,
    totalTicks,
    bots: [botA.name, botB.name],
    isDraw: lastOutcome === null,
  };

  callbacks?.onMatchComplete?.(matchResult);

  return matchResult;
}
