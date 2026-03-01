import { io, type Socket } from 'socket.io-client';

import type {
  BuildOutcomePayload,
  BuildPreviewPayload,
  BuildQueuedPayload,
  ChatMessagePayload,
  ClientToServerEvents,
  MembershipParticipant,
  MatchFinishedPayload,
  PlayerProfilePayload,
  RoomCountdownPayload,
  RoomErrorPayload,
  RoomJoinedPayload,
  RoomLeftPayload,
  RoomListEntryPayload,
  RoomMembershipPayload,
  RoomStatus,
  RoomSlotClaimedPayload,
  RoomStatePayload,
  ServerToClientEvents,
  StructureTemplateSummary,
  TeamIncomeBreakdownPayload,
} from '#rts-engine';

import {
  aggregateIncomeDelta,
  deriveIncomeDeltaSamples,
  formatRelativeEta,
  groupPendingByExecuteTick,
  type AggregatedIncomeDelta,
  type IncomeDeltaSample,
} from './economy-view-model.js';

type RoomListEntry = RoomListEntryPayload;
type StatePayload = RoomStatePayload;
type TemplateSummary = StructureTemplateSummary;
type TeamPayload = StatePayload['teams'][number];
type BuildPreview = BuildPreviewPayload;
type BuildOutcome = BuildOutcomePayload;

interface SelectedTemplatePlacement {
  templateId: string;
  x: number;
  y: number;
}

interface TeamEconomySnapshot {
  tick: number;
  resources: number;
  income: number;
  incomeBreakdown: TeamIncomeBreakdownPayload;
}

interface Cell {
  x: number;
  y: number;
}

function getRequiredElement<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) {
    throw new Error(`Missing #${id}`);
  }
  return el as T;
}

function getTeamLabel(slotId: string): string {
  if (slotId === 'team-1') {
    return 'Team A';
  }
  if (slotId === 'team-2') {
    return 'Team B';
  }
  return slotId;
}

function getTeamColor(slotId: string): string {
  if (slotId === 'team-1') {
    return 'var(--team-a)';
  }
  if (slotId === 'team-2') {
    return 'var(--team-b)';
  }
  return 'var(--accent)';
}

function generateStableIdFragment(): string {
  if (
    typeof crypto !== 'undefined' &&
    typeof crypto.randomUUID === 'function'
  ) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

const canvas = getRequiredElement<HTMLCanvasElement>('grid');
const ctxRaw = canvas.getContext('2d');
if (!ctxRaw) {
  throw new Error('Failed to initialize canvas 2d context');
}
const ctx: CanvasRenderingContext2D = ctxRaw;

const generationEl = getRequiredElement<HTMLElement>('generation');
const statusEl = getRequiredElement<HTMLElement>('status');
const roomEl = getRequiredElement<HTMLElement>('room');
const roomCodeEl = getRequiredElement<HTMLElement>('room-code');
const teamEl = getRequiredElement<HTMLElement>('team');
const resourcesEl = getRequiredElement<HTMLElement>('resources');
const incomeEl = getRequiredElement<HTMLElement>('income');
const baseEl = getRequiredElement<HTMLElement>('base');
const hudResourcesEl = getRequiredElement<HTMLElement>('hud-resources');
const hudIncomeEl = getRequiredElement<HTMLElement>('hud-income');
const hudDeltaChipEl = getRequiredElement<HTMLElement>('hud-delta-chip');
const incomeBreakdownBaseEl = getRequiredElement<HTMLElement>(
  'income-breakdown-base',
);
const incomeBreakdownStructuresEl = getRequiredElement<HTMLElement>(
  'income-breakdown-structures',
);
const incomeBreakdownActiveEl = getRequiredElement<HTMLElement>(
  'income-breakdown-active',
);
const queuePlacementEl = getRequiredElement<HTMLElement>('queue-placement');
const queueCostEl = getRequiredElement<HTMLElement>('queue-cost');
const queueFeedbackEl = getRequiredElement<HTMLElement>('queue-feedback');
const queueBuildButton = getRequiredElement<HTMLButtonElement>('queue-build');
const pendingTimelineEl =
  getRequiredElement<HTMLDivElement>('pending-timeline');
const messageEl = getRequiredElement<HTMLElement>('message');
const lobbyStatusEl = getRequiredElement<HTMLElement>('lobby-status');
const lobbyCountdownEl = getRequiredElement<HTMLElement>('lobby-countdown');
const lifecycleStatusLineEl = getRequiredElement<HTMLElement>(
  'lifecycle-status-line',
);
const lobbyPlayerSlotsEl =
  getRequiredElement<HTMLDivElement>('lobby-player-slots');
const lobbySpectatorsEl =
  getRequiredElement<HTMLDivElement>('lobby-spectators');
const spawnMarkersEl = getRequiredElement<HTMLDivElement>('spawn-markers');
const spectatorBannerEl =
  getRequiredElement<HTMLDivElement>('spectator-banner');
const spectatorBannerTitleEl = getRequiredElement<HTMLElement>(
  'spectator-banner-title',
);
const spectatorBannerTextEl = getRequiredElement<HTMLElement>(
  'spectator-banner-text',
);
const countdownOverlayEl =
  getRequiredElement<HTMLDivElement>('countdown-overlay');
const countdownSecondsEl = getRequiredElement<HTMLElement>('countdown-seconds');
const countdownDetailEl = getRequiredElement<HTMLElement>('countdown-detail');
const finishedPanelEl = getRequiredElement<HTMLElement>('finished-panel');
const finishedSummaryEl = getRequiredElement<HTMLElement>('finished-summary');
const finishedResultsEl = getRequiredElement<HTMLElement>('finished-results');
const finishedComparatorEl = getRequiredElement<HTMLElement>(
  'finished-comparator',
);
const restartStatusEl = getRequiredElement<HTMLElement>('restart-status');
const finishedMinimizeButton =
  getRequiredElement<HTMLButtonElement>('finished-minimize');
const finishedToggleViewButton = getRequiredElement<HTMLButtonElement>(
  'finished-toggle-view',
);
const restartMatchButton =
  getRequiredElement<HTMLButtonElement>('restart-match');

const playerNameEl = getRequiredElement<HTMLInputElement>('player-name');
const setNameButton = getRequiredElement<HTMLButtonElement>('set-name');

const templateSelectEl =
  getRequiredElement<HTMLSelectElement>('template-select');
const buildModeEl = getRequiredElement<HTMLSelectElement>('build-mode');
const buildDelayEl = getRequiredElement<HTMLInputElement>('build-delay');

const newRoomNameEl = getRequiredElement<HTMLInputElement>('new-room-name');
const newRoomSizeEl = getRequiredElement<HTMLInputElement>('new-room-size');
const createRoomButton = getRequiredElement<HTMLButtonElement>('create-room');
const joinRoomCodeEl = getRequiredElement<HTMLInputElement>('join-room-code');
const joinRoomCodeButton = getRequiredElement<HTMLButtonElement>(
  'join-room-code-button',
);
const leaveRoomButton = getRequiredElement<HTMLButtonElement>('leave-room');
const refreshRoomsButton =
  getRequiredElement<HTMLButtonElement>('refresh-rooms');
const roomListEl = getRequiredElement<HTMLDivElement>('room-list');

const claimTeamOneButton =
  getRequiredElement<HTMLButtonElement>('claim-team-1');
const claimTeamTwoButton =
  getRequiredElement<HTMLButtonElement>('claim-team-2');
const toggleReadyButton = getRequiredElement<HTMLButtonElement>('toggle-ready');
const startMatchButton = getRequiredElement<HTMLButtonElement>('start-match');

const chatLogEl = getRequiredElement<HTMLDivElement>('chat-log');
const chatInputEl = getRequiredElement<HTMLInputElement>('chat-input');
const chatSendButton = getRequiredElement<HTMLButtonElement>('chat-send');
const toastStackEl = getRequiredElement<HTMLDivElement>('toast-stack');

const SESSION_STORAGE_KEY = 'life-rts.session-id';

function getOrCreateSessionId(): string {
  const fallback = `session-${generateStableIdFragment()}`;
  try {
    const existing = localStorage.getItem(SESSION_STORAGE_KEY);
    if (existing && existing.trim()) {
      return existing;
    }
    localStorage.setItem(SESSION_STORAGE_KEY, fallback);
    return fallback;
  } catch {
    return fallback;
  }
}

const persistedSessionId = getOrCreateSessionId();
const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io({
  auth: {
    sessionId: persistedSessionId,
  },
});

let gridWidth = 0;
let gridHeight = 0;
let gridBytes: Uint8Array | null = null;
let cellSize = 6;
let isDrawing = false;
let drawValue = true;
let lastCell: Cell | null = null;

let currentRoomId = '-';
let currentRoomCode = '-';
let currentRoomName = '-';
let currentTeamId: number | null = null;
let currentRoomStatus: RoomStatus = 'lobby';
let currentMembership: RoomMembershipPayload | null = null;
let currentSessionId: string | null = persistedSessionId;
let availableTemplates: TemplateSummary[] = [];
let selectedTemplateId = '';
let templateMode = false;
let countdownSecondsRemaining: number | null = null;
let currentMatchFinished: MatchFinishedPayload | null = null;
let isFinishedPanelMinimized = false;
let isFinishedLobbyView = false;
let currentTeamDefeated = false;
let persistentDefeatReason: string | null = null;
let latestOutcomeTimelineMetadata: unknown = null;
let selectedTemplatePlacement: SelectedTemplatePlacement | null = null;
let latestBuildPreview: BuildPreview | null = null;
let previewPending = false;
let lastPreviewRefreshTick: number | null = null;
let lastTeamEconomySnapshot: TeamEconomySnapshot | null = null;
let latestEconomyDeltaCue: AggregatedIncomeDelta | null = null;
let latestEconomyDeltaTick: number | null = null;
let latestEconomyDeltaSamples: IncomeDeltaSample[] = [];
let queueFeedbackOverride: { text: string; isError: boolean } | null = null;

function addToast(message: string, isError = false): void {
  const toast = document.createElement('div');
  toast.className = isError ? 'toast toast--error' : 'toast';
  toast.textContent = message;
  toastStackEl.append(toast);

  const timeoutId = window.setTimeout(() => {
    if (toast.parentElement) {
      toast.remove();
    }
  }, 4200);

  toast.addEventListener('click', () => {
    window.clearTimeout(timeoutId);
    toast.remove();
  });
}

function setMessage(message: string, isError = false): void {
  messageEl.textContent = message;
  messageEl.classList.toggle('message--error', isError);
}

function getClaimFailureMessage(payload: RoomErrorPayload): string {
  if (payload.reason === 'slot-held') {
    return 'Slot is temporarily held for reconnect priority.';
  }
  if (payload.reason === 'slot-full') {
    return 'Slot claim failed: that team slot is already occupied.';
  }
  if (payload.reason === 'team-switch-locked') {
    return 'Team switch is locked after a slot is claimed.';
  }
  if (payload.reason === 'countdown-locked') {
    return 'Ready changes are locked while countdown is running.';
  }
  return payload.message;
}

function appendChatMessage(payload: ChatMessagePayload): void {
  const item = document.createElement('div');
  item.className = 'chat-item';

  const sender = document.createElement('div');
  sender.textContent = payload.senderName;

  const body = document.createElement('div');
  body.className = 'chat-meta';
  body.textContent = payload.message;

  const meta = document.createElement('div');
  meta.className = 'chat-meta';
  const timestamp = new Date(payload.timestamp);
  meta.textContent = `${timestamp.toLocaleTimeString()} | ${payload.senderSessionId}`;

  item.append(sender, body, meta);
  chatLogEl.append(item);
  chatLogEl.scrollTop = chatLogEl.scrollHeight;
}

function updateLobbyControls(): void {
  if (!currentMembership || !currentSessionId) {
    claimTeamOneButton.disabled = false;
    claimTeamTwoButton.disabled = false;
    toggleReadyButton.disabled = true;
    startMatchButton.disabled = true;
    startMatchButton.textContent = 'Host Start';
    return;
  }

  const self = currentMembership.participants.find(
    (participant) => participant.sessionId === currentSessionId,
  );
  const isPlayer = self?.role === 'player';
  const isHost = currentMembership.hostSessionId === currentSessionId;
  const ready = Boolean(self?.ready);
  const lifecycleLocked = currentMembership.status !== 'lobby';
  const canHostStartOrRestart =
    currentMembership.status === 'lobby' ||
    currentMembership.status === 'finished';

  claimTeamOneButton.disabled = isPlayer || lifecycleLocked;
  claimTeamTwoButton.disabled = isPlayer || lifecycleLocked;
  toggleReadyButton.disabled = !isPlayer || lifecycleLocked;
  startMatchButton.disabled = !isHost || !canHostStartOrRestart;
  startMatchButton.textContent =
    currentMembership.status === 'finished' ? 'Host Restart' : 'Host Start';
  toggleReadyButton.textContent = ready ? 'Set Not Ready' : 'Set Ready';
}

function resolveJoinDisplayName(): string {
  const trimmed = playerNameEl.value.trim();
  if (trimmed) {
    const normalized = trimmed.slice(0, 24);
    playerNameEl.value = normalized;
    return normalized;
  }

  const fallback = `guest-${generateStableIdFragment().slice(0, 8)}`;
  playerNameEl.value = fallback;
  return fallback;
}

function syncPlayerNameBeforeJoin(): void {
  const name = resolveJoinDisplayName();
  socket.emit('player:set-name', { name });
}

function getSelectedTemplate(): TemplateSummary | null {
  if (!selectedTemplateId) return null;
  return availableTemplates.find(({ id }) => id === selectedTemplateId) ?? null;
}

function formatSigned(value: number): string {
  return value > 0 ? `+${value}` : `${value}`;
}

function readDelayTicks(): number {
  const parsed = Number.parseInt(buildDelayEl.value, 10);
  if (!Number.isFinite(parsed)) {
    buildDelayEl.value = '2';
    return 2;
  }

  const normalized = Math.max(1, Math.min(20, parsed));
  buildDelayEl.value = String(normalized);
  return normalized;
}

function describeBuildFailureReason(reason: string | undefined): string {
  if (reason === 'outside-territory') {
    return 'outside territory';
  }
  if (reason === 'out-of-bounds') {
    return 'out of bounds';
  }
  if (reason === 'occupied-site') {
    return 'occupied site';
  }
  if (reason === 'unknown-template') {
    return 'unknown template';
  }
  if (reason === 'invalid-coordinates') {
    return 'invalid coordinates';
  }
  if (reason === 'invalid-delay') {
    return 'invalid delay';
  }
  if (reason === 'team-defeated') {
    return 'team defeated';
  }
  if (reason === 'match-finished') {
    return 'match finished';
  }
  if (reason === 'template-compare-failed') {
    return 'template compare failed';
  }
  if (reason === 'apply-failed') {
    return 'apply failed';
  }
  return 'validation failed';
}

function formatDeficitCopy(
  needed: number,
  current: number,
  deficit: number,
): string {
  return `Need ${needed}, current ${current} (deficit ${deficit}).`;
}

function triggerValuePulse(...elements: HTMLElement[]): void {
  for (const element of elements) {
    element.classList.remove('economy-value--pulse');
    void element.offsetWidth;
    element.classList.add('economy-value--pulse');
  }
}

function cloneIncomeBreakdown(
  breakdown: TeamIncomeBreakdownPayload,
): TeamIncomeBreakdownPayload {
  return {
    base: breakdown.base,
    structures: breakdown.structures,
    total: breakdown.total,
    activeStructureCount: breakdown.activeStructureCount,
  };
}

function resetQueueFeedbackOverride(): void {
  queueFeedbackOverride = null;
}

function setQueueFeedbackOverride(message: string, isError: boolean): void {
  queueFeedbackOverride = { text: message, isError };
}

function clearSelectedTemplatePlacement(): void {
  selectedTemplatePlacement = null;
  latestBuildPreview = null;
  previewPending = false;
  lastPreviewRefreshTick = null;
  resetQueueFeedbackOverride();
}

function updateQueuePlacementCopy(): void {
  if (!selectedTemplatePlacement) {
    queuePlacementEl.textContent =
      'Select a board placement while in Template Queue mode.';
    return;
  }

  queuePlacementEl.textContent = `Placement: (${selectedTemplatePlacement.x}, ${selectedTemplatePlacement.y}) for ${selectedTemplatePlacement.templateId}.`;
}

function updateQueueAffordabilityUi(): void {
  updateQueuePlacementCopy();

  queueCostEl.classList.remove('queue-cost--affordable', 'queue-cost--blocked');
  if (!latestBuildPreview) {
    queueCostEl.textContent = 'Cost: --';
  } else {
    queueCostEl.textContent = `Cost: ${latestBuildPreview.needed} | Current: ${latestBuildPreview.current}`;
    queueCostEl.classList.add(
      latestBuildPreview.affordable
        ? 'queue-cost--affordable'
        : 'queue-cost--blocked',
    );
  }

  let feedback = 'Queue action is disabled until placement preview returns.';
  let isError = false;
  let disabled = true;

  if (!templateMode) {
    feedback = 'Switch to Template Queue mode to queue build actions.';
  } else if (!canMutateGameplay()) {
    feedback =
      'Queue action is read-only until you are an active, non-defeated player.';
  } else if (!selectedTemplatePlacement) {
    feedback = 'Select a board placement to request affordability preview.';
  } else if (previewPending) {
    feedback = 'Checking affordability...';
  } else if (!latestBuildPreview) {
    feedback = 'Preview unavailable. Select placement again.';
  } else if (!latestBuildPreview.affordable) {
    if (latestBuildPreview.deficit > 0) {
      feedback = formatDeficitCopy(
        latestBuildPreview.needed,
        latestBuildPreview.current,
        latestBuildPreview.deficit,
      );
    } else {
      feedback = `Cannot queue here: ${describeBuildFailureReason(latestBuildPreview.reason)}.`;
    }
    isError = true;
  } else {
    feedback = `Affordable: need ${latestBuildPreview.needed}, current ${latestBuildPreview.current}.`;
    disabled = false;
  }

  if (queueFeedbackOverride) {
    feedback = queueFeedbackOverride.text;
    isError = queueFeedbackOverride.isError;
  }

  queueBuildButton.disabled = disabled;
  queueFeedbackEl.textContent = feedback;
  queueFeedbackEl.classList.toggle('queue-feedback--error', isError);
}

function emitBuildPreviewForSelectedPlacement(): void {
  if (!selectedTemplatePlacement || !templateMode || !canMutateGameplay()) {
    return;
  }

  resetQueueFeedbackOverride();
  previewPending = true;
  latestBuildPreview = null;
  socket.emit('build:preview', {
    templateId: selectedTemplatePlacement.templateId,
    x: selectedTemplatePlacement.x,
    y: selectedTemplatePlacement.y,
  });
  updateQueueAffordabilityUi();
}

function renderIncomeBreakdown(team: TeamPayload | null): void {
  if (!team) {
    incomeBreakdownBaseEl.textContent = '-';
    incomeBreakdownStructuresEl.textContent = '-';
    incomeBreakdownActiveEl.textContent = '-';
    return;
  }

  incomeBreakdownBaseEl.textContent = formatSigned(team.incomeBreakdown.base);
  incomeBreakdownStructuresEl.textContent = formatSigned(
    team.incomeBreakdown.structures,
  );
  incomeBreakdownActiveEl.textContent = `${team.incomeBreakdown.activeStructureCount}`;
}

function renderPendingTimeline(
  team: TeamPayload | null,
  currentTick: number,
): void {
  pendingTimelineEl.innerHTML = '';

  if (!team || team.pendingBuilds.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'pending-item';
    empty.textContent = 'No pending build events.';
    pendingTimelineEl.append(empty);
    return;
  }

  const groupedRows = groupPendingByExecuteTick(
    team.pendingBuilds,
    currentTick,
  );

  for (const group of groupedRows) {
    const groupEl = document.createElement('section');
    groupEl.className = 'pending-group';

    const title = document.createElement('p');
    title.className = 'pending-group__title';
    title.textContent = `Execute tick ${group.executeTick} (${group.etaLabel})`;
    groupEl.append(title);

    for (const row of group.items) {
      const item = document.createElement('article');
      item.className = 'pending-item';

      const name = document.createElement('div');
      name.className = 'pending-item__name';
      name.textContent = `${row.templateName} (#${row.eventId})`;

      const meta = document.createElement('div');
      meta.className = 'pending-item__meta';
      meta.textContent = `tick ${row.executeTick} | ${formatRelativeEta(row.executeTick, currentTick)} | at (${row.x}, ${row.y})`;

      item.append(name, meta);
      groupEl.append(item);
    }

    pendingTimelineEl.append(groupEl);
  }
}

function renderEconomyDeltaChip(team: TeamPayload | null): void {
  if (!team || !latestEconomyDeltaCue) {
    hudDeltaChipEl.classList.add('is-hidden');
    return;
  }

  const parts: string[] = [];
  if (latestEconomyDeltaCue.netDelta !== 0) {
    parts.push(`net ${formatSigned(latestEconomyDeltaCue.netDelta)}/tick`);
  }
  if (latestEconomyDeltaCue.resourceDelta !== 0) {
    parts.push(`res ${formatSigned(latestEconomyDeltaCue.resourceDelta)}`);
  }

  if (parts.length === 0) {
    hudDeltaChipEl.classList.add('is-hidden');
    return;
  }

  hudDeltaChipEl.classList.remove('is-hidden');
  hudDeltaChipEl.classList.toggle(
    'economy-delta-chip--negative',
    team.income < 0 || latestEconomyDeltaCue.isNegativeNet,
  );
  hudDeltaChipEl.textContent = `${parts.join(' | ')} • ${latestEconomyDeltaCue.causeLabel}`;
}

function resetEconomyTracking(): void {
  lastTeamEconomySnapshot = null;
  latestEconomyDeltaCue = null;
  latestEconomyDeltaTick = null;
  latestEconomyDeltaSamples = [];
  resourcesEl.classList.remove(
    'economy-value--negative',
    'economy-value--pulse',
  );
  incomeEl.classList.remove('economy-value--negative', 'economy-value--pulse');
  hudResourcesEl.classList.remove(
    'economy-value--negative',
    'economy-value--pulse',
  );
  hudIncomeEl.classList.remove(
    'economy-value--negative',
    'economy-value--pulse',
  );
  renderEconomyDeltaChip(null);
  renderIncomeBreakdown(null);
  renderPendingTimeline(null, 0);
}

function syncEconomyHud(team: TeamPayload | null, tick: number): void {
  if (!team) {
    hudResourcesEl.textContent = '-';
    hudIncomeEl.textContent = '-';
    incomeEl.classList.remove('economy-value--negative');
    hudIncomeEl.classList.remove('economy-value--negative');
    renderIncomeBreakdown(null);
    renderPendingTimeline(null, tick);
    latestEconomyDeltaCue = null;
    renderEconomyDeltaChip(null);
    lastTeamEconomySnapshot = null;
    latestEconomyDeltaTick = null;
    latestEconomyDeltaSamples = [];
    return;
  }

  hudResourcesEl.textContent = `${team.resources}`;
  hudIncomeEl.textContent = `${team.income}/tick`;
  const netNegative = team.income < 0;
  incomeEl.classList.toggle('economy-value--negative', netNegative);
  hudIncomeEl.classList.toggle('economy-value--negative', netNegative);

  renderIncomeBreakdown(team);
  renderPendingTimeline(team, tick);

  const nextSnapshot: TeamEconomySnapshot = {
    tick,
    resources: team.resources,
    income: team.income,
    incomeBreakdown: cloneIncomeBreakdown(team.incomeBreakdown),
  };

  const previousSnapshot = lastTeamEconomySnapshot;
  if (previousSnapshot) {
    const resourceDelta = nextSnapshot.resources - previousSnapshot.resources;
    const incomeDelta = nextSnapshot.income - previousSnapshot.income;
    const resourceChanged = resourceDelta !== 0;
    const incomeChanged = incomeDelta !== 0;

    if (resourceChanged) {
      triggerValuePulse(resourcesEl, hudResourcesEl);
    }
    if (incomeChanged) {
      triggerValuePulse(incomeEl, hudIncomeEl);
    }

    if (resourceChanged || incomeChanged) {
      if (latestEconomyDeltaTick !== nextSnapshot.tick) {
        latestEconomyDeltaTick = nextSnapshot.tick;
        latestEconomyDeltaSamples = [];
      }

      latestEconomyDeltaSamples.push(
        ...deriveIncomeDeltaSamples(
          nextSnapshot.tick,
          previousSnapshot.incomeBreakdown,
          nextSnapshot.incomeBreakdown,
        ),
      );

      if (resourceDelta !== 0) {
        latestEconomyDeltaSamples.push({
          tick: nextSnapshot.tick,
          netDelta: 0,
          resourceDelta,
          cause: resourceDelta > 0 ? 'income tick' : 'queue spend',
        });
      }

      const tickCue = aggregateIncomeDelta(latestEconomyDeltaSamples).find(
        ({ tick: cueTick }) => cueTick === nextSnapshot.tick,
      );
      latestEconomyDeltaCue = tickCue ?? null;
    } else if (latestEconomyDeltaTick !== nextSnapshot.tick) {
      latestEconomyDeltaCue = null;
    }
  }

  lastTeamEconomySnapshot = nextSnapshot;
  renderEconomyDeltaChip(team);
}

function selectTemplatePlacementAt(cell: Cell): void {
  const template = getSelectedTemplate();
  if (!template) {
    setMessage('No template selected.', true);
    return;
  }

  const x = cell.x - Math.floor(template.width / 2);
  const y = cell.y - Math.floor(template.height / 2);
  selectedTemplatePlacement = {
    templateId: template.id,
    x,
    y,
  };
  lastPreviewRefreshTick = null;
  resetQueueFeedbackOverride();
  setMessage(`Template placement selected at (${x}, ${y}).`);
  emitBuildPreviewForSelectedPlacement();
  updateQueueAffordabilityUi();
}

function updateTemplateOptions(): void {
  templateSelectEl.innerHTML = '';

  if (availableTemplates.length === 0) {
    clearSelectedTemplatePlacement();
    const option = document.createElement('option');
    option.value = '';
    option.textContent = 'No templates';
    templateSelectEl.append(option);
    selectedTemplateId = '';
    updateQueueAffordabilityUi();
    return;
  }

  for (const template of availableTemplates) {
    const option = document.createElement('option');
    option.value = template.id;
    option.textContent = `${template.name} (${template.width}x${template.height}) | base ${template.activationCost}`;
    templateSelectEl.append(option);
  }

  if (!selectedTemplateId || !getSelectedTemplate()) {
    selectedTemplateId = availableTemplates[0].id;
    clearSelectedTemplatePlacement();
  }
  templateSelectEl.value = selectedTemplateId;
  updateQueueAffordabilityUi();
}

function getSelfParticipant(): MembershipParticipant | null {
  if (!currentMembership || !currentSessionId) {
    return null;
  }
  return (
    currentMembership.participants.find(
      (participant) => participant.sessionId === currentSessionId,
    ) ?? null
  );
}

function isCurrentUserHost(): boolean {
  if (!currentMembership || !currentSessionId) {
    return false;
  }
  return currentMembership.hostSessionId === currentSessionId;
}

function getLifecycleLabel(status: RoomStatus): string {
  if (status === 'countdown') {
    return `Countdown ${countdownSecondsRemaining ?? '?'}s`;
  }
  if (status === 'active') {
    return 'Active';
  }
  if (status === 'finished') {
    return 'Finished';
  }
  return 'Lobby';
}

function canMutateGameplay(): boolean {
  const self = getSelfParticipant();
  return Boolean(
    self &&
    self.role === 'player' &&
    currentRoomStatus === 'active' &&
    !currentTeamDefeated,
  );
}

function getReadOnlyBannerCopy(): {
  title: string;
  text: string;
  defeated: boolean;
} | null {
  if (currentRoomId === '-') {
    return null;
  }

  if (currentTeamDefeated) {
    return {
      title: 'Defeated - Spectating',
      text:
        persistentDefeatReason ??
        'Your core was breached. You are now in read-only spectating mode while board, HUD, and chat stay live.',
      defeated: true,
    };
  }

  const self = getSelfParticipant();
  if (!self || self.role !== 'player') {
    return {
      title: 'Spectator Mode',
      text: 'You can watch live updates and chat, but gameplay mutations stay disabled.',
      defeated: false,
    };
  }

  if (currentRoomStatus === 'countdown') {
    return {
      title: 'Countdown In Progress',
      text: 'Gameplay controls are read-only until the match becomes active.',
      defeated: false,
    };
  }

  if (currentRoomStatus === 'finished') {
    return {
      title: 'Match Finished',
      text: 'Review results and wait for the host restart to re-enter countdown.',
      defeated: false,
    };
  }

  if (currentRoomStatus === 'lobby') {
    return {
      title: 'Lobby Read-Only',
      text: 'Claim a team and start the match to enable gameplay mutations.',
      defeated: false,
    };
  }

  return null;
}

function updateReadOnlyExperience(): void {
  const gameplayAllowed = canMutateGameplay();

  buildModeEl.disabled = !gameplayAllowed;
  templateSelectEl.disabled = !gameplayAllowed;
  buildDelayEl.disabled = !gameplayAllowed;
  canvas.classList.toggle('canvas--locked', !gameplayAllowed);
  canvas.setAttribute('aria-disabled', gameplayAllowed ? 'false' : 'true');

  const bannerCopy = getReadOnlyBannerCopy();
  spectatorBannerEl.classList.toggle('is-hidden', bannerCopy === null);

  if (!bannerCopy) {
    updateQueueAffordabilityUi();
    return;
  }

  spectatorBannerEl.classList.toggle(
    'spectator-banner--defeated',
    bannerCopy.defeated,
  );
  spectatorBannerTitleEl.textContent = bannerCopy.title;
  spectatorBannerTextEl.textContent = bannerCopy.text;
  updateQueueAffordabilityUi();
}

function syncCurrentTeamIdFromState(payload: StatePayload): void {
  if (!currentSessionId) {
    currentTeamId = null;
    return;
  }

  const sessionId = currentSessionId;

  const nextTeam = payload.teams.find(({ playerIds }) =>
    playerIds.includes(sessionId),
  );
  currentTeamId = nextTeam?.id ?? null;
}

function formatOutcomeLabel(
  outcome: MatchFinishedPayload['winner']['outcome'],
): string {
  if (outcome === 'winner') {
    return 'Winner';
  }
  if (outcome === 'eliminated') {
    return 'Eliminated';
  }
  return 'Defeated';
}

function formatLeaderDelta(value: number, leader: number): string {
  const delta = value - leader;
  if (delta === 0) {
    return '= leader';
  }
  const prefix = delta > 0 ? '+' : '';
  return `${prefix}${delta} vs leader`;
}

function renderFinishedResults(): void {
  finishedResultsEl.innerHTML = '';

  if (!currentMatchFinished) {
    finishedSummaryEl.textContent =
      'Match finished. Waiting for final ranked results payload.';
    finishedComparatorEl.textContent = '';
    return;
  }

  finishedSummaryEl.textContent = `Winner: Team ${currentMatchFinished.winner.teamId}. Ranked standings use winner/defeated/eliminated outcomes for multi-team-safe copy.`;
  finishedComparatorEl.textContent = `Ranking comparator: ${currentMatchFinished.comparator}`;

  const leader = currentMatchFinished.ranked[0];

  for (const rankedTeam of currentMatchFinished.ranked) {
    const row = document.createElement('article');
    row.className = 'finished-row';

    const head = document.createElement('div');
    head.className = 'finished-row__head';

    const title = document.createElement('h3');
    title.className = 'finished-row__title';
    title.textContent = `${rankedTeam.rank}. Team ${rankedTeam.teamId}`;

    const outcome = document.createElement('p');
    outcome.className = 'finished-row__outcome';
    outcome.textContent = formatOutcomeLabel(rankedTeam.outcome);

    head.append(title, outcome);

    const stats = document.createElement('div');
    stats.className = 'finished-row__stats';
    stats.innerHTML = [
      `Core: ${rankedTeam.coreState} | ${rankedTeam.finalCoreHp} HP (${formatLeaderDelta(rankedTeam.finalCoreHp, leader.finalCoreHp)})`,
      `Territory: ${rankedTeam.territoryCellCount} cells (${formatLeaderDelta(rankedTeam.territoryCellCount, leader.territoryCellCount)})`,
      `Queued builds: ${rankedTeam.queuedBuildCount} (${formatLeaderDelta(rankedTeam.queuedBuildCount, leader.queuedBuildCount)})`,
      `Applied/rejected: ${rankedTeam.appliedBuildCount}/${rankedTeam.rejectedBuildCount} (applied ${formatLeaderDelta(rankedTeam.appliedBuildCount, leader.appliedBuildCount)} | rejected ${formatLeaderDelta(rankedTeam.rejectedBuildCount, leader.rejectedBuildCount)})`,
    ]
      .map((line) => `<div>${line}</div>`)
      .join('');

    row.append(head, stats);
    finishedResultsEl.append(row);
  }
}

function updateCountdownOverlay(): void {
  if (currentRoomStatus !== 'countdown') {
    countdownOverlayEl.classList.add('is-hidden');
    return;
  }

  countdownOverlayEl.classList.remove('is-hidden');
  countdownSecondsEl.textContent = String(countdownSecondsRemaining ?? 0);
  countdownDetailEl.textContent =
    'Match is about to start. Board view is read-only until countdown completes.';
}

function updateFinishedPanelState(): void {
  const finishedVisible =
    currentRoomStatus === 'finished' && !isFinishedLobbyView;

  finishedPanelEl.classList.toggle('is-hidden', !finishedVisible);
  finishedPanelEl.classList.toggle(
    'finished-panel--minimized',
    isFinishedPanelMinimized,
  );
  finishedPanelEl.classList.toggle(
    'finished-panel--lobby-view',
    isFinishedLobbyView,
  );
  finishedPanelEl.dataset.timelineMetadata = latestOutcomeTimelineMetadata
    ? 'available'
    : 'none';

  finishedMinimizeButton.textContent = isFinishedPanelMinimized
    ? 'Expand'
    : 'Minimize';
  finishedToggleViewButton.textContent = isFinishedLobbyView
    ? 'Back to Results'
    : 'Return to Lobby View';

  const isHost = isCurrentUserHost();
  restartMatchButton.disabled = !isHost;
  restartStatusEl.textContent = isHost
    ? 'Host controls restart. Countdown starts immediately when pressed.'
    : 'Waiting for host to restart this finished match.';
}

function updateLifecycleStatusLine(): void {
  lifecycleStatusLineEl.textContent = `Lifecycle: ${getLifecycleLabel(currentRoomStatus)}`;
}

function updateLifecycleUi(): void {
  updateLifecycleStatusLine();
  updateCountdownOverlay();
  updateFinishedPanelState();
  updateReadOnlyExperience();
}

function applyRoomStatus(nextStatus: RoomStatus): void {
  const previousStatus = currentRoomStatus;
  currentRoomStatus = nextStatus;

  if (nextStatus !== 'finished') {
    isFinishedLobbyView = false;
    isFinishedPanelMinimized = false;
  }

  if (previousStatus === 'finished' && nextStatus === 'countdown') {
    currentMatchFinished = null;
    currentTeamDefeated = false;
    persistentDefeatReason = null;
    latestOutcomeTimelineMetadata = null;
    renderFinishedResults();
  }

  updateLifecycleUi();
}

function renderRoomList(rooms: RoomListEntry[]): void {
  roomListEl.innerHTML = '';

  for (const room of rooms) {
    const item = document.createElement('div');
    item.className = 'room-item';

    const title = document.createElement('div');
    title.textContent = `${room.name} (#${room.roomId}, code ${room.roomCode})`;

    const details = document.createElement('div');
    details.className = 'slot-meta';
    details.textContent = `${room.width}x${room.height} | ${room.players} players | ${room.spectators} spectators | ${room.status}`;

    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = 'Join';
    button.addEventListener('click', () => {
      syncPlayerNameBeforeJoin();
      socket.emit('room:join', { roomId: room.roomId });
    });

    item.append(title, details, button);
    roomListEl.append(item);
  }
}

function decodeBase64ToBytes(encoded: string): Uint8Array {
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function getBit(bytes: Uint8Array, index: number): boolean {
  const byteIndex = index >> 3;
  const bitIndex = index & 7;
  const mask = 1 << (7 - bitIndex);
  return (bytes[byteIndex] & mask) !== 0;
}

function getCell(x: number, y: number): number {
  if (!gridBytes) return 0;
  const idx = y * gridWidth + x;
  return getBit(gridBytes, idx) ? 1 : 0;
}

function chooseCellSize(width: number): number {
  const maxWidth = Math.max(240, window.innerWidth - 32);
  const proposed = Math.floor(maxWidth / width);
  return Math.max(3, Math.min(8, proposed));
}

function resizeCanvas(): void {
  if (!gridWidth || !gridHeight) return;

  cellSize = chooseCellSize(gridWidth);
  const ratio = window.devicePixelRatio || 1;
  const cssWidth = gridWidth * cellSize;
  const cssHeight = gridHeight * cellSize;

  canvas.style.width = `${cssWidth}px`;
  canvas.style.height = `${cssHeight}px`;
  canvas.width = Math.floor(cssWidth * ratio);
  canvas.height = Math.floor(cssHeight * ratio);
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
}

function render(): void {
  if (!gridBytes) return;

  ctx.fillStyle = '#05070d';
  ctx.fillRect(0, 0, gridWidth * cellSize, gridHeight * cellSize);

  ctx.fillStyle = '#46d5b6';
  for (let y = 0; y < gridHeight; y += 1) {
    for (let x = 0; x < gridWidth; x += 1) {
      const idx = y * gridWidth + x;
      if (!getBit(gridBytes, idx)) continue;
      ctx.fillRect(x * cellSize, y * cellSize, cellSize, cellSize);
    }
  }

  if (templateMode) {
    const template = getSelectedTemplate();
    if (
      template &&
      selectedTemplatePlacement &&
      selectedTemplatePlacement.templateId === template.id
    ) {
      ctx.strokeStyle = 'rgba(70, 213, 182, 0.75)';
      ctx.lineWidth = 1;
      ctx.strokeRect(
        selectedTemplatePlacement.x * cellSize + 0.5,
        selectedTemplatePlacement.y * cellSize + 0.5,
        template.width * cellSize,
        template.height * cellSize,
      );
    }
  }
}

function pointerToCell(event: PointerEvent): Cell | null {
  const rect = canvas.getBoundingClientRect();
  const x = Math.floor((event.clientX - rect.left) / cellSize);
  const y = Math.floor((event.clientY - rect.top) / cellSize);
  if (x < 0 || y < 0 || x >= gridWidth || y >= gridHeight) return null;
  return { x, y };
}

function sendUpdate(x: number, y: number, alive: boolean): void {
  if (!canMutateGameplay()) {
    setMessage(
      'Gameplay edits are disabled while you are in read-only mode.',
      true,
    );
    return;
  }
  socket.emit('cell:update', { x, y, alive });
}

function chooseTemplatePlacement(cell: Cell): void {
  if (!canMutateGameplay()) {
    setMessage('Template queues are disabled while you are spectating.', true);
    return;
  }

  if (!currentRoomId || currentRoomId === '-') {
    setMessage('Join a room before queuing templates.', true);
    return;
  }

  selectTemplatePlacementAt(cell);
}

function updateTeamStats(payload: StatePayload): void {
  syncCurrentTeamIdFromState(payload);

  roomEl.textContent = `${payload.roomName} (#${payload.roomId})`;
  roomCodeEl.textContent = currentRoomCode;

  if (currentTeamId === null) {
    currentTeamDefeated = false;
    teamEl.textContent = 'Spectator';
    resourcesEl.textContent = '-';
    incomeEl.textContent = '-';
    baseEl.textContent = 'Unknown';
    syncEconomyHud(null, payload.tick);
    updateQueueAffordabilityUi();
    return;
  }

  const team = payload.teams.find(({ id }) => id === currentTeamId);
  if (!team) {
    currentTeamDefeated = false;
    teamEl.textContent = '#?';
    resourcesEl.textContent = '-';
    incomeEl.textContent = '-';
    baseEl.textContent = 'Unknown';
    syncEconomyHud(null, payload.tick);
    updateQueueAffordabilityUi();
    return;
  }

  currentTeamDefeated = team.defeated;
  if (currentTeamDefeated && !persistentDefeatReason) {
    persistentDefeatReason =
      'Your team was defeated. You are now spectating in read-only mode.';
  }

  teamEl.textContent = `#${team.id}`;
  resourcesEl.textContent = `${team.resources}`;
  incomeEl.textContent = `${team.income}/tick`;
  if (team.defeated) {
    baseEl.textContent = 'Breached';
  } else if (team.baseIntact) {
    baseEl.textContent = 'Intact';
  } else {
    baseEl.textContent = 'Critical';
  }

  syncEconomyHud(team, payload.tick);
  updateQueueAffordabilityUi();
}

function renderLobbyStatus(payload: RoomMembershipPayload): void {
  const hostText = payload.hostSessionId
    ? `Host: ${payload.hostSessionId}`
    : 'Host: none';
  lobbyStatusEl.textContent = `${hostText} | rev ${payload.revision} | ${payload.status}`;
  countdownSecondsRemaining = payload.countdownSecondsRemaining;

  if (payload.status === 'countdown') {
    const seconds = payload.countdownSecondsRemaining ?? 0;
    lobbyCountdownEl.textContent = `Match starts in ${seconds}s`;
    return;
  }

  if (payload.status === 'active') {
    lobbyCountdownEl.textContent = 'Match active';
    return;
  }

  if (payload.status === 'finished') {
    lobbyCountdownEl.textContent = 'Match finished';
    return;
  }

  lobbyCountdownEl.textContent = 'Waiting for both players to ready up';
}

function createBadge(label: string, className: string): HTMLElement {
  const badge = document.createElement('span');
  badge.className = `badge ${className}`;
  badge.textContent = label;
  return badge;
}

function createHeldBadge(participant: MembershipParticipant): HTMLElement {
  const badge = document.createElement('span');
  badge.className = 'badge badge--held';

  const dot = document.createElement('span');
  dot.className = 'status-dot status-dot--held';
  badge.append(dot);

  const heldRemainingMs =
    participant.holdExpiresAt === null
      ? 0
      : Math.max(0, participant.holdExpiresAt - Date.now());
  const heldRemainingSec = Math.ceil(heldRemainingMs / 1000);

  const text = document.createElement('span');
  text.textContent = `Disconnected (${heldRemainingSec}s hold)`;
  badge.append(text);

  return badge;
}

function renderLobbyMembership(payload: RoomMembershipPayload): void {
  currentMembership = payload;
  currentRoomCode = payload.roomCode;
  roomCodeEl.textContent = payload.roomCode;
  applyRoomStatus(payload.status);

  renderLobbyStatus(payload);

  lobbyPlayerSlotsEl.innerHTML = '';
  const participantBySession = new Map(
    payload.participants.map((participant) => [
      participant.sessionId,
      participant,
    ]),
  );

  for (const [slotId, occupantSessionId] of Object.entries(payload.slots)) {
    const row = document.createElement('div');
    row.className = 'slot-item';

    const head = document.createElement('div');
    head.className = 'slot-head';

    const teamInfo = document.createElement('div');
    teamInfo.className = 'slot-team';

    const chip = document.createElement('span');
    chip.className = 'team-chip';
    chip.style.backgroundColor = getTeamColor(slotId);

    const label = document.createElement('strong');
    label.textContent = getTeamLabel(slotId);
    teamInfo.append(chip, label);

    const occupant = document.createElement('div');
    if (!occupantSessionId) {
      occupant.textContent = 'Open slot';
      occupant.className = 'slot-meta';
      head.append(teamInfo, occupant);
      row.append(head);
      lobbyPlayerSlotsEl.append(row);
      continue;
    }

    const participant = participantBySession.get(occupantSessionId);
    const displayName = participant?.displayName ?? occupantSessionId;
    occupant.textContent = `${displayName} (${getTeamLabel(slotId)})`;
    head.append(teamInfo, occupant);

    const meta = document.createElement('div');
    meta.className = 'slot-meta';
    meta.textContent = `session: ${occupantSessionId}`;

    const badges = document.createElement('div');
    badges.className = 'badge-row';

    if (payload.hostSessionId === occupantSessionId) {
      badges.append(createBadge('Host', 'badge--host'));
    }

    if (participant?.ready) {
      badges.append(createBadge('Ready', 'badge--ready'));
    } else {
      badges.append(createBadge('Not Ready', 'badge--held'));
    }

    if (participant?.connectionStatus === 'held') {
      badges.append(createHeldBadge(participant));
    }

    row.append(head, meta, badges);
    lobbyPlayerSlotsEl.append(row);
  }

  lobbySpectatorsEl.innerHTML = '';
  const spectators = payload.participants.filter(
    (participant) => participant.role === 'spectator',
  );

  if (spectators.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'spectator-item';
    empty.textContent = 'No spectators in room.';
    lobbySpectatorsEl.append(empty);
  } else {
    for (const spectator of spectators) {
      const item = document.createElement('div');
      item.className = 'spectator-item';

      const title = document.createElement('div');
      title.textContent = spectator.displayName;

      const meta = document.createElement('div');
      meta.className = 'spectator-meta';
      meta.textContent = `session: ${spectator.sessionId}`;

      item.append(title, meta);
      lobbySpectatorsEl.append(item);
    }
  }

  updateLobbyControls();
  updateLifecycleUi();
}

function renderSpawnMarkers(payload: StatePayload): void {
  spawnMarkersEl.innerHTML = '';

  if (payload.teams.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'spawn-item';
    empty.textContent = 'Spawn markers appear after player slots are claimed.';
    spawnMarkersEl.append(empty);
    return;
  }

  const sortedTeams = [...payload.teams].sort((a, b) => a.id - b.id);
  for (const team of sortedTeams) {
    const item = document.createElement('div');
    item.className = 'spawn-item';

    const title = document.createElement('div');
    title.className = 'slot-team';

    const chip = document.createElement('span');
    chip.className = 'team-chip';
    chip.style.backgroundColor =
      team.id === 1 ? 'var(--team-a)' : 'var(--team-b)';

    const label = document.createElement('strong');
    label.textContent = `Team ${team.id}`;
    title.append(chip, label);

    const meta = document.createElement('div');
    meta.className = 'spawn-meta';
    meta.textContent = `base top-left: (${team.baseTopLeft.x}, ${team.baseTopLeft.y})`;

    item.append(title, meta);
    spawnMarkersEl.append(item);
  }
}

function handleDraw(event: PointerEvent): void {
  const cell = pointerToCell(event);
  if (!cell) return;

  if (lastCell && lastCell.x === cell.x && lastCell.y === cell.y) return;

  lastCell = cell;
  sendUpdate(cell.x, cell.y, drawValue);
}

canvas.addEventListener('pointerdown', (event) => {
  if (!gridBytes) return;

  if (!canMutateGameplay()) {
    setMessage(
      'Board edits are read-only until you are an active, non-defeated player.',
      true,
    );
    return;
  }

  const cell = pointerToCell(event);
  if (!cell) return;

  if (templateMode) {
    chooseTemplatePlacement(cell);
    return;
  }

  canvas.setPointerCapture(event.pointerId);
  isDrawing = true;
  drawValue = getCell(cell.x, cell.y) === 0;
  lastCell = null;
  handleDraw(event);
});

canvas.addEventListener('pointermove', (event) => {
  if (!isDrawing) return;
  handleDraw(event);
});

function stopDrawing(event: PointerEvent): void {
  if (!isDrawing) return;
  isDrawing = false;
  lastCell = null;
  if (event.pointerId) {
    canvas.releasePointerCapture(event.pointerId);
  }
}

canvas.addEventListener('pointerup', stopDrawing);
canvas.addEventListener('pointerleave', stopDrawing);
canvas.addEventListener('pointercancel', stopDrawing);

window.addEventListener('resize', () => {
  const previousCellSize = cellSize;
  resizeCanvas();
  if (cellSize !== previousCellSize) render();
});

socket.on('connect', () => {
  statusEl.textContent = 'Connected';
  socket.emit('room:list');
});

socket.on('disconnect', () => {
  statusEl.textContent = 'Disconnected';
});

socket.on('room:list', (rooms: RoomListEntry[]) => {
  renderRoomList(rooms);
});

socket.on('room:joined', (payload: RoomJoinedPayload) => {
  currentRoomId = payload.roomId;
  currentRoomCode = payload.roomCode;
  currentRoomName = payload.roomName;
  currentTeamId = payload.teamId;
  countdownSecondsRemaining = null;
  currentMatchFinished = null;
  isFinishedPanelMinimized = false;
  isFinishedLobbyView = false;
  currentTeamDefeated = false;
  persistentDefeatReason = null;
  latestOutcomeTimelineMetadata = null;
  currentMembership = null;
  clearSelectedTemplatePlacement();
  resetEconomyTracking();
  availableTemplates = payload.templates;
  selectedTemplateId = payload.templates[0]?.id ?? '';
  updateTemplateOptions();
  playerNameEl.value = payload.playerName;
  chatLogEl.innerHTML = '';
  applyRoomStatus('lobby');
  renderFinishedResults();

  setMessage(
    payload.teamId === null
      ? `Joined ${payload.roomName} as spectator.`
      : `Joined ${payload.roomName} as team #${payload.teamId}.`,
  );

  gridWidth = payload.state.width;
  gridHeight = payload.state.height;
  gridBytes = decodeBase64ToBytes(payload.state.grid);
  generationEl.textContent = payload.state.generation.toString();
  updateTeamStats(payload.state);
  renderSpawnMarkers(payload.state);
  resizeCanvas();
  render();
  updateLobbyControls();
  updateLifecycleUi();
});

socket.on('room:left', (_payload: RoomLeftPayload) => {
  currentRoomId = '-';
  currentRoomCode = '-';
  currentRoomName = '-';
  currentTeamId = null;
  countdownSecondsRemaining = null;
  currentMatchFinished = null;
  isFinishedPanelMinimized = false;
  isFinishedLobbyView = false;
  currentTeamDefeated = false;
  persistentDefeatReason = null;
  latestOutcomeTimelineMetadata = null;
  currentMembership = null;
  clearSelectedTemplatePlacement();
  resetEconomyTracking();
  applyRoomStatus('lobby');
  renderFinishedResults();

  roomEl.textContent = '-';
  roomCodeEl.textContent = '-';
  teamEl.textContent = '-';
  resourcesEl.textContent = '-';
  incomeEl.textContent = '-';
  baseEl.textContent = 'Unknown';

  lobbyStatusEl.textContent = '';
  lobbyCountdownEl.textContent = 'Waiting for host';
  lobbyPlayerSlotsEl.innerHTML = '';
  lobbySpectatorsEl.innerHTML = '';
  spawnMarkersEl.innerHTML = '';
  chatLogEl.innerHTML = '';

  setMessage('You left the room.');
  updateLobbyControls();
  updateLifecycleUi();
  updateQueueAffordabilityUi();
});

socket.on('room:error', (payload: RoomErrorPayload) => {
  let message = getClaimFailureMessage(payload);

  if (
    payload.reason === 'insufficient-resources' &&
    typeof payload.needed === 'number' &&
    typeof payload.current === 'number' &&
    typeof payload.deficit === 'number'
  ) {
    const deficitCopy = formatDeficitCopy(
      payload.needed,
      payload.current,
      payload.deficit,
    );
    message = `Queue rejected. ${deficitCopy}`;
    setQueueFeedbackOverride(deficitCopy, true);
  } else if (
    payload.reason === 'outside-territory' ||
    payload.reason === 'out-of-bounds' ||
    payload.reason === 'occupied-site' ||
    payload.reason === 'unknown-template' ||
    payload.reason === 'invalid-coordinates'
  ) {
    setQueueFeedbackOverride(
      `Cannot queue here: ${describeBuildFailureReason(payload.reason)}.`,
      true,
    );
  }

  if (payload.reason === 'defeated') {
    persistentDefeatReason =
      payload.message ||
      'Your team is defeated. You are now spectating in read-only mode.';
    currentTeamDefeated = true;
    updateLifecycleUi();
  }

  setMessage(message, true);
  addToast(message, true);
  updateQueueAffordabilityUi();
});

socket.on('room:membership', (payload: RoomMembershipPayload) => {
  renderLobbyMembership(payload);
});

socket.on('room:countdown', (payload: RoomCountdownPayload) => {
  if (payload.roomId !== currentRoomId) {
    return;
  }

  countdownSecondsRemaining = payload.secondsRemaining;
  applyRoomStatus('countdown');
  lobbyCountdownEl.textContent = `Match starts in ${payload.secondsRemaining}s`;
  updateLifecycleUi();
});

socket.on('room:match-started', () => {
  countdownSecondsRemaining = null;
  applyRoomStatus('active');
  lobbyCountdownEl.textContent = 'Match active';
  addToast('Match started. Good luck.');
});

socket.on('room:match-finished', (payload: MatchFinishedPayload) => {
  if (payload.roomId !== currentRoomId) {
    return;
  }

  const payloadWithTimeline = payload as MatchFinishedPayload & {
    timeline?: unknown;
    timelineMetadata?: unknown;
  };

  // Track optional timeline metadata now, but defer timeline UI/zoom rendering.
  latestOutcomeTimelineMetadata =
    payloadWithTimeline.timelineMetadata ??
    payloadWithTimeline.timeline ??
    null;
  currentMatchFinished = payload;
  applyRoomStatus('finished');
  renderFinishedResults();
  updateLifecycleUi();
});

socket.on('room:slot-claimed', (payload: RoomSlotClaimedPayload) => {
  const label = getTeamLabel(payload.slotId);
  currentTeamId = payload.teamId;
  setMessage(`Slot claimed: ${label}.`);
  addToast(`Slot claimed successfully: ${label}.`);
});

socket.on('chat:message', (payload: ChatMessagePayload) => {
  appendChatMessage(payload);
});

socket.on('player:profile', (payload: PlayerProfilePayload) => {
  currentSessionId = payload.playerId;
  socket.auth = {
    sessionId: payload.playerId,
  };
  try {
    localStorage.setItem(SESSION_STORAGE_KEY, payload.playerId);
  } catch {
    // Ignore storage failures; reconnect auth still uses in-memory value.
  }
  playerNameEl.value = payload.name;
  updateLobbyControls();
  updateLifecycleUi();
});

socket.on('build:preview', (payload: BuildPreview) => {
  if (payload.roomId !== currentRoomId || currentTeamId === null) {
    return;
  }

  if (payload.teamId !== currentTeamId || !selectedTemplatePlacement) {
    return;
  }

  if (
    payload.templateId !== selectedTemplatePlacement.templateId ||
    payload.x !== selectedTemplatePlacement.x ||
    payload.y !== selectedTemplatePlacement.y
  ) {
    return;
  }

  previewPending = false;
  latestBuildPreview = payload;
  resetQueueFeedbackOverride();
  updateQueueAffordabilityUi();
});

socket.on('build:outcome', (payload: BuildOutcome) => {
  if (payload.roomId !== currentRoomId || currentTeamId === null) {
    return;
  }

  if (payload.teamId !== currentTeamId) {
    return;
  }

  if (payload.outcome === 'rejected') {
    const rejectionCopy =
      payload.reason === 'insufficient-resources' &&
      typeof payload.needed === 'number' &&
      typeof payload.current === 'number' &&
      typeof payload.deficit === 'number'
        ? formatDeficitCopy(payload.needed, payload.current, payload.deficit)
        : `Build #${payload.eventId} rejected: ${describeBuildFailureReason(payload.reason)}.`;

    setQueueFeedbackOverride(rejectionCopy, true);
    setMessage(rejectionCopy, true);
  } else {
    resetQueueFeedbackOverride();
  }

  updateQueueAffordabilityUi();
});

socket.on('build:queued', (payload: BuildQueuedPayload) => {
  setQueueFeedbackOverride(
    `Queued event #${payload.eventId} for execute tick ${payload.executeTick}.`,
    false,
  );
  setMessage(
    `Build queued (#${payload.eventId}) for tick ${payload.executeTick}.`,
  );
  updateQueueAffordabilityUi();
});

socket.on('state', (payload: StatePayload) => {
  gridWidth = payload.width;
  gridHeight = payload.height;
  gridBytes = decodeBase64ToBytes(payload.grid);
  generationEl.textContent = payload.generation.toString();
  if (payload.roomId !== currentRoomId) {
    currentRoomId = payload.roomId;
  }
  if (payload.roomName !== currentRoomName) {
    currentRoomName = payload.roomName;
  }

  updateTeamStats(payload);
  renderSpawnMarkers(payload);
  resizeCanvas();
  render();
  updateLifecycleUi();

  if (
    selectedTemplatePlacement &&
    templateMode &&
    canMutateGameplay() &&
    !previewPending &&
    lastPreviewRefreshTick !== payload.tick
  ) {
    lastPreviewRefreshTick = payload.tick;
    emitBuildPreviewForSelectedPlacement();
  }
});

setNameButton.addEventListener('click', () => {
  const name = resolveJoinDisplayName();
  socket.emit('player:set-name', {
    name,
  });
});

buildModeEl.addEventListener('change', () => {
  templateMode = buildModeEl.value === 'template';
  if (!templateMode) {
    clearSelectedTemplatePlacement();
  }
  setMessage(
    templateMode
      ? 'Template mode: click on the board to select placement, then use Queue Selected Placement.'
      : 'Paint mode: click and drag to toggle cells.',
  );
  render();
  updateQueueAffordabilityUi();
});

templateSelectEl.addEventListener('change', () => {
  selectedTemplateId = templateSelectEl.value;
  clearSelectedTemplatePlacement();
  render();
  updateQueueAffordabilityUi();
});

buildDelayEl.addEventListener('change', () => {
  readDelayTicks();
});

createRoomButton.addEventListener('click', () => {
  const size = Number(newRoomSizeEl.value);
  syncPlayerNameBeforeJoin();
  socket.emit('room:create', {
    name: newRoomNameEl.value,
    width: size,
    height: size,
  });
});

joinRoomCodeButton.addEventListener('click', () => {
  const roomCode = joinRoomCodeEl.value.trim();
  if (!roomCode) {
    setMessage('Enter a room code before joining.', true);
    return;
  }

  syncPlayerNameBeforeJoin();
  socket.emit('room:join', {
    roomCode,
  });
});

leaveRoomButton.addEventListener('click', () => {
  socket.emit('room:leave');
});

claimTeamOneButton.addEventListener('click', () => {
  socket.emit('room:claim-slot', { slotId: 'team-1' });
});

claimTeamTwoButton.addEventListener('click', () => {
  socket.emit('room:claim-slot', { slotId: 'team-2' });
});

toggleReadyButton.addEventListener('click', () => {
  if (!currentMembership || !currentSessionId) {
    return;
  }

  const self = currentMembership.participants.find(
    (participant) => participant.sessionId === currentSessionId,
  );
  if (!self) {
    return;
  }

  socket.emit('room:set-ready', { ready: !self.ready });
});

startMatchButton.addEventListener('click', () => {
  socket.emit('room:start');
});

queueBuildButton.addEventListener('click', () => {
  if (
    !selectedTemplatePlacement ||
    !latestBuildPreview ||
    !latestBuildPreview.affordable
  ) {
    updateQueueAffordabilityUi();
    return;
  }

  resetQueueFeedbackOverride();
  socket.emit('build:queue', {
    templateId: selectedTemplatePlacement.templateId,
    x: selectedTemplatePlacement.x,
    y: selectedTemplatePlacement.y,
    delayTicks: readDelayTicks(),
  });
  updateQueueAffordabilityUi();
});

finishedMinimizeButton.addEventListener('click', () => {
  isFinishedPanelMinimized = !isFinishedPanelMinimized;
  updateFinishedPanelState();
});

finishedToggleViewButton.addEventListener('click', () => {
  isFinishedLobbyView = !isFinishedLobbyView;
  updateFinishedPanelState();
  if (isFinishedLobbyView) {
    addToast('Local lobby view enabled. You remain in the room for restart.');
  }
});

restartMatchButton.addEventListener('click', () => {
  if (currentRoomStatus !== 'finished') {
    return;
  }
  socket.emit('room:start');
});

chatSendButton.addEventListener('click', () => {
  const message = chatInputEl.value.trim();
  if (!message) {
    setMessage('Chat message cannot be empty.', true);
    return;
  }

  socket.emit('chat:send', { message });
  chatInputEl.value = '';
});

chatInputEl.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter') {
    return;
  }

  event.preventDefault();
  chatSendButton.click();
});

refreshRoomsButton.addEventListener('click', () => {
  socket.emit('room:list');
});

updateTemplateOptions();
resetEconomyTracking();
updateLobbyControls();
renderFinishedResults();
updateLifecycleUi();
updateQueueAffordabilityUi();
