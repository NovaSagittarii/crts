import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { io, type Socket } from 'socket.io-client';

import {
  createServer,
  type GameServer,
} from '../../../apps/server/src/server.js';
import {
  BASE_FOOTPRINT_HEIGHT,
  BASE_FOOTPRINT_WIDTH,
  BUILD_ZONE_RADIUS,
  estimateTransformedTemplateBounds,
  getBaseCenter,
} from '#rts-engine';

import type {
  BuildOutcomePayload,
  BuildQueuedPayload,
  DestroyOutcomePayload,
  DestroyQueuedPayload,
  PlacementTransformInput,
  RoomErrorPayload,
  RoomJoinedPayload,
  RoomMembershipPayload,
  RoomSlotClaimedPayload,
  RoomStatePayload,
  TeamPayload,
} from '#rts-engine';

interface Cell {
  x: number;
  y: number;
}

interface MatchFinishedRankedTeam {
  rank: number;
  teamId: number;
  outcome: 'winner' | 'defeated' | 'eliminated';
  finalCoreHp: number;
  coreState: 'intact' | 'destroyed';
  territoryCellCount: number;
  queuedBuildCount: number;
  appliedBuildCount: number;
  rejectedBuildCount: number;
}

interface MatchFinishedPayload {
  roomId: string;
  winner: MatchFinishedRankedTeam;
  ranked: MatchFinishedRankedTeam[];
  comparator: string;
}

interface ActiveMatchSetup {
  host: Socket;
  guest: Socket;
  roomId: string;
  hostJoined: RoomJoinedPayload;
  guestJoined: RoomJoinedPayload;
  hostTeam: TeamPayload;
  guestTeam: TeamPayload;
}

interface ClientOptions {
  sessionId?: string;
}

function createClient(port: number, options: ClientOptions = {}): Socket {
  const socket = io(`http://localhost:${port}`, {
    autoConnect: false,
    transports: ['websocket'],
    auth: {
      sessionId: options.sessionId,
    },
  });
  socket.connect();
  return socket;
}

function waitForEvent<T>(
  socket: Socket,
  event: string,
  timeoutMs = 3000,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, onEvent);
      reject(new Error(`Timed out waiting for ${event}`));
    }, timeoutMs);

    function onEvent(payload: T): void {
      clearTimeout(timer);
      resolve(payload);
    }

    socket.once(event, onEvent);
  });
}

async function waitForMembership(
  socket: Socket,
  roomId: string,
  predicate: (payload: RoomMembershipPayload) => boolean,
  attempts = 30,
  timeoutMs = 3000,
): Promise<RoomMembershipPayload> {
  for (let index = 0; index < attempts; index += 1) {
    const payload = await waitForEvent<RoomMembershipPayload>(
      socket,
      'room:membership',
      timeoutMs,
    );
    if (payload.roomId === roomId && predicate(payload)) {
      return payload;
    }
  }

  throw new Error('Membership condition not met in allotted attempts');
}

async function waitForState(
  socket: Socket,
  roomId: string,
  predicate: (payload: RoomStatePayload) => boolean,
  attempts = 40,
  timeoutMs = 3000,
): Promise<RoomStatePayload> {
  for (let index = 0; index < attempts; index += 1) {
    const payload = await waitForEvent<RoomStatePayload>(
      socket,
      'state',
      timeoutMs,
    );
    if (payload.roomId === roomId && predicate(payload)) {
      return payload;
    }
  }

  throw new Error('State condition not met in allotted attempts');
}

async function claimSlot(socket: Socket, slotId: string): Promise<void> {
  const claimedPromise = waitForEvent<RoomSlotClaimedPayload>(
    socket,
    'room:slot-claimed',
  );
  socket.emit('room:claim-slot', { slotId });
  const claimed = await claimedPromise;
  if (claimed.teamId === null) {
    throw new Error(`Expected ${slotId} claim to assign a team`);
  }
}

function getTeamByPlayerId(
  state: RoomStatePayload,
  playerId: string,
): TeamPayload {
  const team = state.teams.find(({ playerIds }) =>
    playerIds.includes(playerId),
  );
  if (!team) {
    throw new Error(`Unable to resolve team for player ${playerId}`);
  }
  return team;
}

function collectCandidatePlacements(
  team: TeamPayload,
  template: RoomJoinedPayload['templates'][number],
  roomWidth: number,
  roomHeight: number,
  transform?: PlacementTransformInput,
): Cell[] {
  const placements: Cell[] = [];
  const baseCenter = getBaseCenter(team.baseTopLeft);
  const baseLeft = team.baseTopLeft.x;
  const baseTop = team.baseTopLeft.y;
  const baseRight = baseLeft + BASE_FOOTPRINT_WIDTH;
  const baseBottom = baseTop + BASE_FOOTPRINT_HEIGHT;
  const transformedSize = estimateTransformedTemplateBounds(
    template,
    transform,
  );

  for (let y = -10; y <= 10; y += 2) {
    for (let x = -10; x <= 10; x += 2) {
      const buildX = team.baseTopLeft.x + x;
      const buildY = team.baseTopLeft.y + y;
      if (buildX < 0 || buildY < 0) {
        continue;
      }
      if (
        buildX + transformedSize.width > roomWidth ||
        buildY + transformedSize.height > roomHeight
      ) {
        continue;
      }

      const intersectsBase =
        buildX < baseRight &&
        buildX + transformedSize.width > baseLeft &&
        buildY < baseBottom &&
        buildY + transformedSize.height > baseTop;
      if (intersectsBase) {
        continue;
      }

      let fullyInsideBuildZone = true;
      for (let ty = 0; ty < transformedSize.height; ty += 1) {
        for (let tx = 0; tx < transformedSize.width; tx += 1) {
          const dx = buildX + tx - baseCenter.x;
          const dy = buildY + ty - baseCenter.y;
          if (dx * dx + dy * dy > BUILD_ZONE_RADIUS * BUILD_ZONE_RADIUS) {
            fullyInsideBuildZone = false;
            break;
          }
        }
        if (!fullyInsideBuildZone) {
          break;
        }
      }

      if (!fullyInsideBuildZone) {
        continue;
      }

      placements.push({ x: buildX, y: buildY });
    }
  }

  return placements;
}

interface QueueBuildAttempt {
  templateId: string;
  transform?: PlacementTransformInput;
}

interface QueueAppliedBuildOptions {
  templateId?: string;
  transform?: PlacementTransformInput;
  delayTicks?: number;
}

function waitForBuildQueueResponse(
  socket: Socket,
  timeoutMs = 4000,
): Promise<{ queued: BuildQueuedPayload } | { error: RoomErrorPayload }> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('Timed out waiting for build queue response'));
    }, timeoutMs);

    function cleanup(): void {
      clearTimeout(timer);
      socket.off('build:queued', onQueued);
      socket.off('room:error', onError);
    }

    function onQueued(payload: BuildQueuedPayload): void {
      cleanup();
      resolve({ queued: payload });
    }

    function onError(payload: RoomErrorPayload): void {
      cleanup();
      resolve({ error: payload });
    }

    socket.once('build:queued', onQueued);
    socket.once('room:error', onError);
  });
}

function waitForDestroyQueueResponse(
  socket: Socket,
  timeoutMs = 4000,
): Promise<{ queued: DestroyQueuedPayload } | { error: RoomErrorPayload }> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('Timed out waiting for destroy queue response'));
    }, timeoutMs);

    function cleanup(): void {
      clearTimeout(timer);
      socket.off('destroy:queued', onQueued);
      socket.off('room:error', onError);
    }

    function onQueued(payload: DestroyQueuedPayload): void {
      cleanup();
      resolve({ queued: payload });
    }

    function onError(payload: RoomErrorPayload): void {
      cleanup();
      resolve({ error: payload });
    }

    socket.once('destroy:queued', onQueued);
    socket.once('room:error', onError);
  });
}

function waitForBuildOutcome(
  socket: Socket,
  eventId: number,
  timeoutMs = 12_000,
): Promise<BuildOutcomePayload> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off('build:outcome', onOutcome);
      reject(
        new Error(`Timed out waiting for build:outcome for event ${eventId}`),
      );
    }, timeoutMs);

    function onOutcome(payload: BuildOutcomePayload): void {
      if (payload.eventId !== eventId) {
        return;
      }

      clearTimeout(timer);
      socket.off('build:outcome', onOutcome);
      resolve(payload);
    }

    socket.on('build:outcome', onOutcome);
  });
}

function waitForDestroyOutcome(
  socket: Socket,
  eventId: number,
  timeoutMs = 12_000,
): Promise<DestroyOutcomePayload> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off('destroy:outcome', onOutcome);
      reject(
        new Error(`Timed out waiting for destroy:outcome for event ${eventId}`),
      );
    }, timeoutMs);

    function onOutcome(payload: DestroyOutcomePayload): void {
      if (payload.eventId !== eventId) {
        return;
      }

      clearTimeout(timer);
      socket.off('destroy:outcome', onOutcome);
      resolve(payload);
    }

    socket.on('destroy:outcome', onOutcome);
  });
}

async function setupActiveMatch(
  connectClient: () => Socket,
): Promise<ActiveMatchSetup> {
  const host = connectClient();
  await waitForEvent<RoomJoinedPayload>(host, 'room:joined');

  const hostCreatedPromise = waitForEvent<RoomJoinedPayload>(
    host,
    'room:joined',
  );
  host.emit('room:create', {
    name: 'QUAL-02 Loop Room',
    width: 52,
    height: 52,
  });
  const hostJoined = await hostCreatedPromise;

  const guest = connectClient();
  await waitForEvent<RoomJoinedPayload>(guest, 'room:joined');

  const guestJoinedPromise = waitForEvent<RoomJoinedPayload>(
    guest,
    'room:joined',
  );
  guest.emit('room:join', { roomId: hostJoined.roomId });
  const guestJoined = await guestJoinedPromise;

  await claimSlot(host, 'team-1');
  await claimSlot(guest, 'team-2');

  const slotMembershipPromise = waitForMembership(
    host,
    hostJoined.roomId,
    (payload) =>
      payload.slots['team-1'] === hostJoined.playerId &&
      payload.slots['team-2'] === guestJoined.playerId,
  );
  await slotMembershipPromise;

  const readyMembershipPromise = waitForMembership(
    host,
    hostJoined.roomId,
    (payload) =>
      payload.participants.filter(
        ({ role, ready }) => role === 'player' && ready,
      ).length === 2,
  );
  host.emit('room:set-ready', { ready: true });
  guest.emit('room:set-ready', { ready: true });
  await readyMembershipPromise;

  const matchStartedPromise = waitForEvent(host, 'room:match-started', 7000);
  host.emit('room:start');
  await matchStartedPromise;

  await waitForMembership(
    host,
    hostJoined.roomId,
    (payload) => payload.status === 'active',
    40,
  );

  const activeState = await waitForState(
    host,
    hostJoined.roomId,
    (payload) =>
      payload.teams.some(({ playerIds }) =>
        playerIds.includes(hostJoined.playerId),
      ) &&
      payload.teams.some(({ playerIds }) =>
        playerIds.includes(guestJoined.playerId),
      ),
    40,
  );

  return {
    host,
    guest,
    roomId: hostJoined.roomId,
    hostJoined,
    guestJoined,
    hostTeam: getTeamByPlayerId(activeState, hostJoined.playerId),
    guestTeam: getTeamByPlayerId(activeState, guestJoined.playerId),
  };
}

async function queueValidHostBuild(
  match: ActiveMatchSetup,
): Promise<{ queued: BuildQueuedPayload; outcome: BuildOutcomePayload }> {
  const attempts: QueueBuildAttempt[] = [
    {
      templateId: 'block',
      transform: undefined,
    },
  ];

  for (const attempt of attempts) {
    const template = match.hostJoined.templates.find(
      ({ id }) => id === attempt.templateId,
    );
    if (!template) {
      continue;
    }

    const placements = collectCandidatePlacements(
      match.hostTeam,
      template,
      match.hostJoined.state.width,
      match.hostJoined.state.height,
      attempt.transform,
    );

    for (const placement of placements) {
      const queueResponsePromise = waitForBuildQueueResponse(match.host);
      match.host.emit('build:queue', {
        templateId: template.id,
        x: placement.x,
        y: placement.y,
        transform: attempt.transform,
        delayTicks: 12,
      });

      const response = await queueResponsePromise;
      if ('error' in response) {
        continue;
      }

      const outcome = await waitForBuildOutcome(
        match.host,
        response.queued.eventId,
      );
      return {
        queued: response.queued,
        outcome,
      };
    }
  }

  throw new Error('Unable to queue a valid build for QUAL-02 scenario');
}

async function queueAppliedHostBuild(
  match: ActiveMatchSetup,
  options: QueueAppliedBuildOptions = {},
): Promise<{
  queued: BuildQueuedPayload;
  outcome: BuildOutcomePayload;
  structureKey: string;
}> {
  const templateId = options.templateId ?? 'block';
  const template = match.hostJoined.templates.find(
    ({ id }) => id === templateId,
  );
  if (!template) {
    throw new Error(`Expected ${templateId} template to be available`);
  }

  const placements = collectCandidatePlacements(
    match.hostTeam,
    template,
    match.hostJoined.state.width,
    match.hostJoined.state.height,
    options.transform,
  );

  for (const placement of placements) {
    const responsePromise = waitForBuildQueueResponse(match.host);
    match.host.emit('build:queue', {
      templateId: template.id,
      x: placement.x,
      y: placement.y,
      transform: options.transform,
      delayTicks: options.delayTicks ?? 8,
    });

    const response = await responsePromise;
    if ('error' in response) {
      continue;
    }

    const outcome = await waitForBuildOutcome(
      match.host,
      response.queued.eventId,
    );
    if (outcome.outcome !== 'applied') {
      continue;
    }

    const stateWithBuiltBlock = await waitForState(
      match.host,
      match.roomId,
      (payload) => {
        const hostTeam = getTeamByPlayerId(payload, match.hostJoined.playerId);
        return hostTeam.structures.some(
          (structure) =>
            !structure.isCore &&
            structure.templateId === template.id &&
            structure.hp > 0,
        );
      },
      40,
    );

    const hostTeam = getTeamByPlayerId(
      stateWithBuiltBlock,
      match.hostJoined.playerId,
    );
    const structure = hostTeam.structures.find(
      (candidate) =>
        !candidate.isCore &&
        candidate.templateId === template.id &&
        candidate.hp > 0,
    );
    if (!structure) {
      continue;
    }

    return {
      queued: response.queued,
      outcome,
      structureKey: structure.key,
    };
  }

  throw new Error(`Unable to queue and apply host ${templateId} structure`);
}

describe('QUAL-02 quality gate integration loop', () => {
  let server: GameServer;
  let port = 0;
  const sockets: Socket[] = [];

  beforeEach(async () => {
    server = createServer({ port: 0, width: 52, height: 52, tickMs: 40 });
    port = await server.start();
  });

  afterEach(async () => {
    for (const socket of sockets) {
      socket.close();
    }
    await server.stop();
  });

  function connectClientForTest(options: ClientOptions = {}): Socket {
    const socket = createClient(port, options);
    sockets.push(socket);
    return socket;
  }

  test('QUAL-02: join -> build -> tick -> breach -> defeat with defeated build rejection', async () => {
    const match = await setupActiveMatch(() => connectClientForTest());

    // QUAL-02 requires one explicit build queue + terminal outcome in the loop.
    const { queued, outcome } = await queueValidHostBuild(match);
    expect(queued.eventId).toBeGreaterThan(0);
    expect(outcome.eventId).toBe(queued.eventId);
    expect(outcome.resolvedTick).toBeGreaterThanOrEqual(queued.executeTick);

    const matchFinishedPromise = waitForEvent<MatchFinishedPayload>(
      match.host,
      'room:match-finished',
      8000,
    );

    for (const delayTicks of [16, 17, 18, 19]) {
      const queueResponsePromise = waitForBuildQueueResponse(match.guest);
      match.guest.emit('build:queue', {
        templateId: 'glider',
        x: match.guestTeam.baseTopLeft.x,
        y: match.guestTeam.baseTopLeft.y,
        delayTicks,
      });

      const response = await queueResponsePromise;
      if ('error' in response) {
        throw new Error(
          `Expected breach queue attempt to be accepted, received ${response.error.reason}`,
        );
      }
    }

    const finished = await matchFinishedPromise;
    expect(finished.roomId).toBe(match.roomId);
    expect(finished.comparator).toContain('coreHpBeforeResolution');

    const defeated = finished.ranked.find(
      ({ outcome: rankedOutcome }) => rankedOutcome !== 'winner',
    );
    if (!defeated) {
      throw new Error(
        'Expected a defeated team in room:match-finished payload',
      );
    }

    const defeatedSocket =
      defeated.teamId === match.hostTeam.id ? match.host : match.guest;
    const defeatedBaseTopLeft =
      defeated.teamId === match.hostTeam.id
        ? match.hostTeam.baseTopLeft
        : match.guestTeam.baseTopLeft;

    const defeatedErrorPromise = waitForEvent<RoomErrorPayload>(
      defeatedSocket,
      'room:error',
      4000,
    );
    defeatedSocket.emit('build:queue', {
      templateId: 'block',
      x: defeatedBaseTopLeft.x + 3,
      y: defeatedBaseTopLeft.y + 3,
      delayTicks: 1,
    });
    const defeatedError = await defeatedErrorPromise;

    expect(defeatedError.reason).toBe('defeated');
  }, 45_000);

  test('keeps equivalent transform legality parity and execute-time affordability rejections stable', async () => {
    const match = await setupActiveMatch(() => connectClientForTest());

    const blockTemplate = match.hostJoined.templates.find(
      ({ id }) => id === 'block',
    );
    const generatorTemplate = match.hostJoined.templates.find(
      ({ id }) => id === 'generator',
    );
    if (!blockTemplate || !generatorTemplate) {
      throw new Error('Expected block and generator templates to be available');
    }

    const equivalentTransform: PlacementTransformInput = {
      operations: ['rotate', 'rotate', 'rotate', 'rotate'],
    };
    const identityPlacements = collectCandidatePlacements(
      match.hostTeam,
      blockTemplate,
      match.hostJoined.state.width,
      match.hostJoined.state.height,
    );
    const equivalentPlacements = collectCandidatePlacements(
      match.hostTeam,
      blockTemplate,
      match.hostJoined.state.width,
      match.hostJoined.state.height,
      equivalentTransform,
    );
    const equivalentPlacementSet = new Set(
      equivalentPlacements.map(({ x, y }) => `${x},${y}`),
    );
    const sharedPlacements = identityPlacements.filter(({ x, y }) =>
      equivalentPlacementSet.has(`${x},${y}`),
    );
    if (sharedPlacements.length < 2) {
      throw new Error('Expected at least two shared placement coordinates');
    }

    const parityProbe = sharedPlacements[0];
    match.host.emit('build:preview', {
      templateId: blockTemplate.id,
      x: parityProbe.x,
      y: parityProbe.y,
    });
    const identityPreview = await waitForEvent<
      BuildQueuedPayload & {
        affordable: boolean;
        reason?: string;
        footprint: Cell[];
        bounds: {
          x: number;
          y: number;
          width: number;
          height: number;
        };
      }
    >(match.host, 'build:preview');

    match.host.emit('build:preview', {
      templateId: blockTemplate.id,
      x: parityProbe.x,
      y: parityProbe.y,
      transform: equivalentTransform,
    });
    const equivalentPreview = await waitForEvent<
      BuildQueuedPayload & {
        affordable: boolean;
        reason?: string;
        footprint: Cell[];
        bounds: {
          x: number;
          y: number;
          width: number;
          height: number;
        };
      }
    >(match.host, 'build:preview');

    expect(equivalentPreview.reason).toBe(identityPreview.reason);
    expect(equivalentPreview.affordable).toBe(identityPreview.affordable);
    expect(equivalentPreview.bounds).toEqual(identityPreview.bounds);
    expect(equivalentPreview.footprint).toEqual(identityPreview.footprint);

    const firstQueueResponsePromise = waitForBuildQueueResponse(match.host);
    match.host.emit('build:queue', {
      templateId: blockTemplate.id,
      x: sharedPlacements[0].x,
      y: sharedPlacements[0].y,
      delayTicks: 12,
    });
    const firstQueueResponse = await firstQueueResponsePromise;
    if ('error' in firstQueueResponse) {
      throw new Error(
        `Expected first queue acceptance, received ${firstQueueResponse.error.reason}`,
      );
    }

    const secondQueueResponsePromise = waitForBuildQueueResponse(match.host);
    match.host.emit('build:queue', {
      templateId: blockTemplate.id,
      x: sharedPlacements[1].x,
      y: sharedPlacements[1].y,
      transform: equivalentTransform,
      delayTicks: 12,
    });
    const secondQueueResponse = await secondQueueResponsePromise;
    if ('error' in secondQueueResponse) {
      throw new Error(
        `Expected second queue acceptance, received ${secondQueueResponse.error.reason}`,
      );
    }

    const [firstOutcome, secondOutcome] = await Promise.all([
      waitForBuildOutcome(match.host, firstQueueResponse.queued.eventId),
      waitForBuildOutcome(match.host, secondQueueResponse.queued.eventId),
    ]);
    expect(firstOutcome.outcome).toBe('applied');
    expect(secondOutcome.outcome).toBe('applied');

    const transformedGenerator: PlacementTransformInput = {
      operations: ['rotate', 'mirror-horizontal'],
    };
    const generatorPlacements = collectCandidatePlacements(
      match.hostTeam,
      generatorTemplate,
      match.hostJoined.state.width,
      match.hostJoined.state.height,
      transformedGenerator,
    );
    if (generatorPlacements.length < 3) {
      throw new Error('Expected transformed generator placement candidates');
    }

    const queuedGenerators: Array<{ eventId: number }> = [];
    const generatorOutcomes = new Map<number, BuildOutcomePayload[]>();
    const onGeneratorOutcome = (payload: BuildOutcomePayload): void => {
      const current = generatorOutcomes.get(payload.eventId) ?? [];
      current.push(payload);
      generatorOutcomes.set(payload.eventId, current);
    };
    match.host.on('build:outcome', onGeneratorOutcome);

    for (const placement of generatorPlacements.slice(0, 20)) {
      match.host.emit('build:preview', {
        templateId: generatorTemplate.id,
        x: placement.x,
        y: placement.y,
        transform: transformedGenerator,
      });
      const preview = await waitForEvent<
        BuildQueuedPayload & {
          needed: number;
          current: number;
          reason?: string;
        }
      >(match.host, 'build:preview');

      if (preview.reason === 'insufficient-resources') {
        break;
      }
      if (preview.reason !== undefined) {
        continue;
      }

      const queuePromise = waitForBuildQueueResponse(match.host);
      match.host.emit('build:queue', {
        templateId: generatorTemplate.id,
        x: placement.x,
        y: placement.y,
        transform: transformedGenerator,
        delayTicks: 12,
      });
      const queueResponse = await queuePromise;
      if ('error' in queueResponse) {
        if (queueResponse.error.reason === 'insufficient-resources') {
          break;
        }
        continue;
      }

      queuedGenerators.push({ eventId: queueResponse.queued.eventId });
    }

    if (queuedGenerators.length < 2) {
      match.host.off('build:outcome', onGeneratorOutcome);
      throw new Error(
        'Expected at least two transformed generator queue events',
      );
    }

    const waitStart = Date.now();
    while (
      queuedGenerators.some(
        ({ eventId }) => (generatorOutcomes.get(eventId)?.length ?? 0) === 0,
      )
    ) {
      if (Date.now() - waitStart > 15_000) {
        match.host.off('build:outcome', onGeneratorOutcome);
        throw new Error('Timed out collecting transformed generator outcomes');
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    match.host.off('build:outcome', onGeneratorOutcome);

    const insufficientOutcome = queuedGenerators
      .map(({ eventId }) => generatorOutcomes.get(eventId)?.[0])
      .find(
        (outcome) =>
          outcome?.outcome === 'rejected' &&
          outcome.reason === 'insufficient-resources',
      );
    if (!insufficientOutcome) {
      throw new Error(
        'Expected at least one execute-time insufficient-resources outcome',
      );
    }

    expect(insufficientOutcome.affordable).toBe(false);
    if (
      typeof insufficientOutcome.needed !== 'number' ||
      typeof insufficientOutcome.current !== 'number' ||
      typeof insufficientOutcome.deficit !== 'number'
    ) {
      throw new Error(
        'Expected execute-time insufficient outcome affordability metadata',
      );
    }
    expect(insufficientOutcome.deficit).toBe(
      Math.max(0, insufficientOutcome.needed - insufficientOutcome.current),
    );
  }, 45_000);

  test('keeps transformed structure overlays stable across repeated reconnect loops', async () => {
    const match = await setupActiveMatch(() => connectClientForTest());

    const appliedBuild = await queueAppliedHostBuild(match, {
      templateId: 'block',
      transform: {
        operations: ['rotate', 'mirror-horizontal'],
      },
      delayTicks: 10,
    });
    expect(appliedBuild.outcome.outcome).toBe('applied');

    let activeGuest: Socket = match.guest;

    for (let reconnectCount = 0; reconnectCount < 2; reconnectCount += 1) {
      activeGuest.disconnect();
      activeGuest = connectClientForTest({
        sessionId: match.guestJoined.playerId,
      });

      const rejoined = await waitForEvent<RoomJoinedPayload>(
        activeGuest,
        'room:joined',
        6000,
      );
      expect(rejoined.roomId).toBe(match.roomId);

      const [hostState, reconnectState] = await Promise.all([
        waitForState(
          match.host,
          match.roomId,
          (payload) => {
            const hostTeam = getTeamByPlayerId(
              payload,
              match.hostJoined.playerId,
            );
            return hostTeam.structures.some(
              ({ key, hp }) => key === appliedBuild.structureKey && hp > 0,
            );
          },
          80,
          2000,
        ),
        waitForState(
          activeGuest,
          match.roomId,
          (payload) => {
            const hostTeam = getTeamByPlayerId(
              payload,
              match.hostJoined.playerId,
            );
            return hostTeam.structures.some(
              ({ key, hp }) => key === appliedBuild.structureKey && hp > 0,
            );
          },
          80,
          2000,
        ),
      ]);

      const hostTeam = getTeamByPlayerId(hostState, match.hostJoined.playerId);
      const reconnectTeam = getTeamByPlayerId(
        reconnectState,
        match.hostJoined.playerId,
      );
      expect(reconnectTeam.structures).toEqual(hostTeam.structures);

      const hostStructure = hostTeam.structures.find(
        ({ key }) => key === appliedBuild.structureKey,
      );
      const reconnectStructure = reconnectTeam.structures.find(
        ({ key }) => key === appliedBuild.structureKey,
      );
      expect(hostStructure).toBeDefined();
      expect(reconnectStructure).toEqual(hostStructure);
    }
  }, 70_000);

  test('QUAL-04: build plus destroy stays deterministic across reconnect checkpoints', async () => {
    const match = await setupActiveMatch(() => connectClientForTest());

    const appliedBuild = await queueAppliedHostBuild(match);
    expect(appliedBuild.outcome.outcome).toBe('applied');

    const destroyQueueResponsePromise = waitForDestroyQueueResponse(match.host);
    match.host.emit('destroy:queue', {
      structureKey: appliedBuild.structureKey,
      delayTicks: 20,
    });
    const destroyQueueResponse = await destroyQueueResponsePromise;
    if ('error' in destroyQueueResponse) {
      throw new Error(
        `Expected destroy queue acceptance in QUAL-04 scenario, received ${destroyQueueResponse.error.reason}`,
      );
    }

    const destroyQueued = destroyQueueResponse.queued;
    expect(destroyQueued.idempotent).toBe(false);

    match.guest.disconnect();
    const reconnectGuest = connectClientForTest({
      sessionId: match.guestJoined.playerId,
    });
    const rejoined = await waitForEvent<RoomJoinedPayload>(
      reconnectGuest,
      'room:joined',
      6000,
    );
    expect(rejoined.roomId).toBe(match.roomId);

    await waitForState(
      reconnectGuest,
      match.roomId,
      (payload) => {
        const hostTeam = getTeamByPlayerId(payload, match.hostJoined.playerId);
        return hostTeam.pendingDestroys.some(
          ({ eventId }) => eventId === destroyQueued.eventId,
        );
      },
      60,
      2000,
    );

    const [hostOutcome, reconnectOutcome] = await Promise.all([
      waitForDestroyOutcome(match.host, destroyQueued.eventId, 16_000),
      waitForDestroyOutcome(reconnectGuest, destroyQueued.eventId, 16_000),
    ]);
    expect(reconnectOutcome).toEqual(hostOutcome);
    expect(hostOutcome.outcome).toBe('destroyed');
    expect(hostOutcome.structureKey).toBe(appliedBuild.structureKey);

    const hostSettled = await waitForState(
      match.host,
      match.roomId,
      (payload) => {
        const hostTeam = getTeamByPlayerId(payload, match.hostJoined.playerId);
        const pendingIds = hostTeam.pendingDestroys.map(
          ({ eventId }) => eventId,
        );
        return (
          !pendingIds.includes(destroyQueued.eventId) &&
          !hostTeam.structures.some(
            ({ key, hp }) => key === appliedBuild.structureKey && hp > 0,
          )
        );
      },
      80,
      2000,
    );

    const reconnectSettled = await waitForState(
      reconnectGuest,
      match.roomId,
      (payload) => {
        const hostTeam = getTeamByPlayerId(payload, match.hostJoined.playerId);
        const pendingIds = hostTeam.pendingDestroys.map(
          ({ eventId }) => eventId,
        );
        return (
          !pendingIds.includes(destroyQueued.eventId) &&
          !hostTeam.structures.some(
            ({ key, hp }) => key === appliedBuild.structureKey && hp > 0,
          )
        );
      },
      80,
      2000,
    );

    const hostTeam = getTeamByPlayerId(hostSettled, match.hostJoined.playerId);
    const reconnectTeam = getTeamByPlayerId(
      reconnectSettled,
      match.hostJoined.playerId,
    );
    expect(reconnectTeam.pendingDestroys).toEqual(hostTeam.pendingDestroys);
    expect(reconnectTeam.structures).toEqual(hostTeam.structures);
  }, 60_000);
});
