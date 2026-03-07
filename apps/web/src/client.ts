import { io, type Socket } from 'socket.io-client';
import { Grid } from '#conway-core';

import {
  RtsEngine,
  type BuildPreviewTemplateSnapshot,
  BuildScheduledPayload,
  BuildOutcomePayload,
  BuildQueuedPayload,
  BuildQueueRejectedPayload,
  ChatMessagePayload,
  ClientToServerEvents,
  DestroyScheduledPayload,
  DestroyOutcomePayload,
  DestroyQueuedPayload,
  DestroyQueueRejectedPayload,
  LockstepCheckpointPayload,
  LockstepFallbackPayload,
  MembershipParticipant,
  MatchFinishedPayload,
  MatchStartedPayload,
  PlayerProfilePayload,
  RoomCountdownPayload,
  RoomErrorPayload,
  RoomJoinedPayload,
  RoomLeftPayload,
  RoomListEntryPayload,
  RoomMembershipPayload,
  RoomGridStatePayload,
  PlacementBounds,
  RoomStateHashesPayload,
  RoomStatus,
  RoomSlotClaimedPayload,
  RoomStatePayload,
  RoomStructuresStatePayload,
  ServerToClientEvents,
  StateRequestPayload,
  StructureTemplatePayload,
  TeamPayload,
} from '#rts-engine';

import {
  buildPreviewRequestFromSelection,
  describeBuildFailureReason,
  deriveBuildQueueUi,
  formatDeficitCopy,
  previewMatchesSelection,
  type BuildQueueFeedbackOverride,
  type BuildQueuePreview,
} from './build-queue-view-model.js';
import { BuildModeController } from './build-mode-controller.js';
import { EconomyHudController } from './economy-hud-controller.js';
import { TemplateButtonMenuElement } from './template-button-menu.js';
import {
  applyPlacementTransformOperation,
  createPlacementTransformViewState,
  formatPlacementTransformIndicator,
  toPlacementTransformInput,
  type PlacementTransformViewState,
} from './placement-transform-view-model.js';
import {
  armDestroyConfirm,
  cancelDestroyConfirm,
  canQueueDestroy,
  clearDestroySelection,
  createDestroyViewModelState,
  refreshDestroySelection,
  registerDestroyOutcome,
  registerDestroyQueued,
  syncDestroyPending,
  type DestroySelectableStructure,
  type DestroyViewModelState,
} from './destroy-view-model.js';
import {
  applyAuthoritativeStatus,
  clearReconnectNotice,
  createMatchScreenViewState,
  getReconnectNoticeCopy,
  hasVisibleReconnectNotice,
  isReconnectSyncing,
  markReconnectPending,
  RECONNECT_NOTICE_MS,
  SCREEN_TRANSITION_NOTICE_MS,
  type MatchScreenViewState,
} from './match-screen-view-model.js';
import {
  applyKeyboardPan,
  applyPanDelta,
  applyWheelZoomAtPoint,
  CAMERA_DEFAULT_ZOOM,
  CAMERA_KEYBOARD_ZOOM_FACTOR,
  createCameraViewState,
  normalizeWheelZoomFactor,
  resetCameraToBase,
  screenPointToCell,
  type CameraPanDirection,
  type CameraPoint,
  type CameraViewState,
} from './camera-view-model.js';
import {
  canShowStructureActions,
  createStructureInteractionState,
  DEFAULT_HOVER_LEAVE_GRACE_MS,
  reduceStructureInteraction,
  selectActiveStructureKey,
  selectStructureInteractionMode,
  type StructureInteractionAction,
  type StructureInteractionState,
} from './structure-interaction-view-model.js';
import {
  createTacticalOverlayState,
  DEFAULT_SYNC_STALE_THRESHOLD_MS,
  deriveTacticalOverlayState,
  type TacticalOverlayDetailRow,
  type TacticalOverlaySection,
  type TacticalOverlaySummaryItem,
  type TacticalOverlayTeamSnapshot,
  type TacticalOverlayState,
} from './tactical-overlay-view-model.js';
import { chooseGridCellSize } from './canvas-layout.js';
import {
  DEFAULT_CHAT_LOG_MAX_MESSAGES,
  getChatOverflowCount,
} from './chat-log-view-model.js';
import { computeLocalBuildZoneOverlay } from './local-build-zone-view-model.js';
import { getWrappedBoundsSegments } from './wrapped-grid-view-model.js';
import {
  computeVisibleGridBounds,
  type VisibleGridBounds,
} from './render-viewport.js';
import { createRenderScheduler } from './render-scheduler.js';
import {
  applyAuthoritativeIdentity,
  createPlayerIdentityState,
  resolveTeamIdForSession,
  selectIsHost,
  selectSelfParticipant,
} from './player-identity-view-model.js';
import { deriveLobbyControlsViewModel } from './lobby-controls-view-model.js';
import { deriveLobbyMembershipViewModel } from './lobby-membership-view-model.js';
import { LobbyScreenUi } from './lobby-screen-ui.js';
import { getLobbySlotLabel } from './lobby-slot-presentation.js';
import {
  applyJoinedHashes,
  createStateHashResyncState,
  markAwaitingHashesAfterFullState,
  noteAppliedGridHash,
  noteAppliedMembershipHash,
  noteAppliedStructuresHash,
  reconcileIncomingHashes,
  resetStateHashResyncState,
} from './state-hash-resync-view-model.js';
import {
  createAuthoritativePreviewRefreshState,
  recordAuthoritativePreviewRefresh,
  shouldApplyRoomScopedPayload,
  shouldRefreshAuthoritativePreview,
  type AuthoritativePreviewSection,
  type AuthoritativePreviewRefreshState,
} from './client-sync-helpers.js';

type BuildPreview = BuildQueuePreview & {
  footprint: Cell[];
  illegalCells: Cell[];
  bounds: PlacementBounds;
};

interface VisibleStructure {
  teamId: number;
  key: string;
  templateId: string;
  templateName: string;
  x: number;
  y: number;
  width: number;
  height: number;
  hp: number;
  active: boolean;
  isCore: boolean;
  requiresDestroyConfirm: boolean;
  footprint: Cell[];
}

interface Cell {
  x: number;
  y: number;
}

interface TeamBuildZoneProjectionInput {
  x: number;
  y: number;
  width: number;
  height: number;
  hp: number;
}

function getRequiredElement<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) {
    throw new Error(`Missing #${id}`);
  }
  return el as T;
}

function getTeamLabel(slotId: string): string {
  return getLobbySlotLabel(slotId);
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
const gridViewportEl = getRequiredElement<HTMLDivElement>('grid-viewport');
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
const previewReasonEl = getRequiredElement<HTMLElement>('preview-reason');
const queueCostEl = getRequiredElement<HTMLElement>('queue-cost');
const queueFeedbackEl = getRequiredElement<HTMLElement>('queue-feedback');
const destroySelectionEl = getRequiredElement<HTMLElement>('destroy-selection');
const destroyFeedbackEl = getRequiredElement<HTMLElement>('destroy-feedback');
const destroyQueueButton =
  getRequiredElement<HTMLButtonElement>('destroy-queue');
const destroyConfirmPanelEl = getRequiredElement<HTMLDivElement>(
  'destroy-confirm-panel',
);
const destroyConfirmButton =
  getRequiredElement<HTMLButtonElement>('destroy-confirm');
const destroyCancelButton =
  getRequiredElement<HTMLButtonElement>('destroy-cancel');
const structureInspectorStatusEl = getRequiredElement<HTMLElement>(
  'structure-inspector-status',
);
const structureInspectorTemplateEl = getRequiredElement<HTMLElement>(
  'structure-inspector-template',
);
const structureInspectorOwnerEl = getRequiredElement<HTMLElement>(
  'structure-inspector-owner',
);
const structureInspectorHealthEl = getRequiredElement<HTMLElement>(
  'structure-inspector-health',
);
const structureInspectorStateEl = getRequiredElement<HTMLElement>(
  'structure-inspector-state',
);
const structureInspectorActionHintEl = getRequiredElement<HTMLElement>(
  'structure-inspector-action-hint',
);
const tacticalRailEl = getRequiredElement<HTMLElement>('tactical-rail');
const tacticalSyncHintEl =
  getRequiredElement<HTMLElement>('tactical-sync-hint');
const overlaySummaryEconomyEl = getRequiredElement<HTMLDivElement>(
  'overlay-summary-economy',
);
const overlaySummaryBuildEl = getRequiredElement<HTMLDivElement>(
  'overlay-summary-build',
);
const overlaySummaryTeamEl = getRequiredElement<HTMLDivElement>(
  'overlay-summary-team',
);
const overlayDetailsEconomyEl = getRequiredElement<HTMLDivElement>(
  'overlay-details-economy',
);
const overlayDetailsBuildEl = getRequiredElement<HTMLDivElement>(
  'overlay-details-build',
);
const overlayDetailsTeamEl = getRequiredElement<HTMLDivElement>(
  'overlay-details-team',
);
const overlayPendingEconomyEl = getRequiredElement<HTMLElement>(
  'overlay-pending-economy',
);
const overlayPendingBuildEl = getRequiredElement<HTMLElement>(
  'overlay-pending-build',
);
const overlayPendingTeamEl = getRequiredElement<HTMLElement>(
  'overlay-pending-team',
);
const overlayFeedbackBuildEl = getRequiredElement<HTMLElement>(
  'overlay-feedback-build',
);
const overlayFeedbackTeamEl = getRequiredElement<HTMLElement>(
  'overlay-feedback-team',
);
const overlayTabEconomyButton = getRequiredElement<HTMLButtonElement>(
  'overlay-tab-economy',
);
const overlayTabBuildButton =
  getRequiredElement<HTMLButtonElement>('overlay-tab-build');
const overlayTabTeamButton =
  getRequiredElement<HTMLButtonElement>('overlay-tab-team');
const pendingTimelineEl =
  getRequiredElement<HTMLDivElement>('pending-timeline');
const messageEl = getRequiredElement<HTMLElement>('message');
const cameraStatusEl = getRequiredElement<HTMLElement>('camera-status');
const cameraZoomEl = getRequiredElement<HTMLElement>('camera-zoom');
const lobbyScreenEl = getRequiredElement<HTMLElement>('lobby-screen');
const ingameScreenEl = getRequiredElement<HTMLElement>('ingame-screen');
const lobbyStatusEl = getRequiredElement<HTMLElement>('lobby-status');
const lobbyCountdownEl = getRequiredElement<HTMLElement>('lobby-countdown');
const lifecycleStatusLineEl = getRequiredElement<HTMLElement>(
  'lifecycle-status-line',
);
const edgeBannerEl = getRequiredElement<HTMLElement>('edge-banner');
const reconnectIndicatorEl = getRequiredElement<HTMLElement>(
  'reconnect-indicator',
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
const restartMatchButton =
  getRequiredElement<HTMLButtonElement>('restart-match');

const playerNameEl = getRequiredElement<HTMLInputElement>('player-name');
const setNameButton = getRequiredElement<HTMLButtonElement>('set-name');

const templateButtonMenuEl = getRequiredElement<HTMLDivElement>(
  'template-button-menu',
);
const buildDelayEl = getRequiredElement<HTMLInputElement>('build-delay');
const transformRotateButton =
  getRequiredElement<HTMLButtonElement>('transform-rotate');
const transformMirrorHorizontalButton = getRequiredElement<HTMLButtonElement>(
  'transform-mirror-horizontal',
);
const transformMirrorVerticalButton = getRequiredElement<HTMLButtonElement>(
  'transform-mirror-vertical',
);
const exitBuildModeButton =
  getRequiredElement<HTMLButtonElement>('exit-build-mode');
const transformIndicatorEl = getRequiredElement<HTMLElement>(
  'transform-indicator',
);

const templateButtonMenu = new TemplateButtonMenuElement(
  templateButtonMenuEl,
  (templateId) => {
    activateBuildModeForTemplate(templateId);
  },
);
const economyHudController = new EconomyHudController({
  resourcesEl,
  incomeEl,
  hudResourcesEl,
  hudIncomeEl,
  hudDeltaChipEl,
  incomeBreakdownBaseEl,
  incomeBreakdownStructuresEl,
  incomeBreakdownActiveEl,
  pendingTimelineEl,
});

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

const toggleReadyButton = getRequiredElement<HTMLButtonElement>('toggle-ready');
const startMatchButton = getRequiredElement<HTMLButtonElement>('start-match');
const lobbyScreenUi = new LobbyScreenUi({
  statusEl: lobbyStatusEl,
  countdownEl: lobbyCountdownEl,
  slotListEl: lobbyPlayerSlotsEl,
  spectatorListEl: lobbySpectatorsEl,
  spawnMarkersEl,
  readyButton: toggleReadyButton,
  startButton: startMatchButton,
});

const chatLogEl = getRequiredElement<HTMLDivElement>('chat-log');
const chatInputEl = getRequiredElement<HTMLInputElement>('chat-input');
const chatSendButton = getRequiredElement<HTMLButtonElement>('chat-send');
const toastStackEl = getRequiredElement<HTMLDivElement>('toast-stack');

const SESSION_STORAGE_KEY = 'life-rts.session-id';
const BOOTSTRAP_MEMBERSHIP_TIMEOUT_MS = 6000;
const DEFAULT_WEB_ROOM_SLOT_DEFINITIONS = [
  { slotId: 'team-1', capacity: 2 },
  { slotId: 'team-2', capacity: 2 },
  { slotId: 'team-3', capacity: 2 },
];

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
let gridPackedBytes: ArrayBuffer | null = null;
let authoritativeGrid: Grid | null = null;
let cellSize = 6;
let canvasRatio = window.devicePixelRatio || 1;
let canvasCssWidth = 0;
let canvasCssHeight = 0;
let cameraState: CameraViewState = createCameraViewState();
let isCameraPanning = false;
let cameraPanPointerId: number | null = null;
let lastCameraPanClientPoint: CameraPoint | null = null;
let latestLocalBaseTopLeft: Cell | null = null;

let currentRoomId = '-';
let currentRoomCode = '-';
let currentRoomName = '-';
let currentTeamId: number | null = null;
let currentRoomStatus: RoomStatus = 'lobby';
let matchScreenState: MatchScreenViewState =
  createMatchScreenViewState('lobby');
let currentMembership: RoomMembershipPayload | null = null;
let playerIdentityState = createPlayerIdentityState(
  persistedSessionId,
  playerNameEl.value.trim(),
);
let availableTemplates: StructureTemplatePayload[] = [];
const previewTemplateSnapshotsById = new Map<
  string,
  BuildPreviewTemplateSnapshot
>();
let selectedTemplateId = '';
let placementTransformState: PlacementTransformViewState =
  createPlacementTransformViewState();
let countdownSecondsRemaining: number | null = null;
let currentMatchFinished: MatchFinishedPayload | null = null;
let isFinishedPanelMinimized = false;
let currentTeamDefeated = false;
let persistentDefeatReason: string | null = null;
let latestOutcomeTimelineMetadata: unknown = null;
const buildModeController = new BuildModeController();
let latestBuildPreview: BuildPreview | null = null;
let previewPending = false;
let authoritativePreviewRefreshState: AuthoritativePreviewRefreshState =
  createAuthoritativePreviewRefreshState();
let queueFeedbackOverride: BuildQueueFeedbackOverride | null = null;
let destroyFeedbackOverride: { text: string; isError: boolean } | null = null;
let lifecycleConnectionNotice: string | null = null;
let bootstrapMembershipTimeoutId: number | null = null;
let connectionIssueVisible = false;
let lastConnectionErrorSignature: string | null = null;
let lastBuildErrorToast: { signature: string; at: number } | null = null;
let destroyViewState: DestroyViewModelState = createDestroyViewModelState();
let structureInteractionState: StructureInteractionState =
  createStructureInteractionState();
let structureHoverTickTimeoutId: number | null = null;
let tacticalOverlayState: TacticalOverlayState = createTacticalOverlayState();
let tacticalOverlayTickTimeoutId: number | null = null;
let activeOverlayTab: 'economy' | 'build' | 'team' = 'economy';
let latestTacticalTeamSnapshot: TeamPayload | null = null;
let lastAuthoritativeStateAtMs: number | null = null;
let overlayBuildFeedbackCopy = 'No recent build action.';
let overlayBuildFeedbackPending = false;
let overlayBuildFeedbackIsError = false;
let overlayTeamFeedbackCopy = 'No recent team action.';
let overlayTeamFeedbackPending = false;
let overlayTeamFeedbackIsError = false;
let visibleStructures: VisibleStructure[] = [];
let structureCellIndex = new Map<string, VisibleStructure>();
let teamBuildZoneProjectionInputsByTeamId = new Map<
  number,
  TeamBuildZoneProjectionInput[]
>();
let localBuildZoneCells: Cell[] = [];
let localBuildZoneCellKeys = new Set<number>();
let localBuildZoneSignature = '';
const localBuildZoneCoverageCache = new Map<string, readonly number[]>();
let edgeBannerTimeoutId: number | null = null;
let reconnectNoticeTimeoutId: number | null = null;
let lastStateRequestAtMs = 0;
let stateHashResyncState = createStateHashResyncState();
const pendingStateRequestSections = new Set<
  NonNullable<StateRequestPayload['sections']>[number]
>();
let pendingStateRequestTimerId: number | null = null;

const BUILD_ERROR_TOAST_DEDUPE_MS = 800;
const CAMERA_KEYBOARD_WORLD_STEP_CELLS = 8;
const LOCAL_BUILD_ZONE_CACHE_MAX_ENTRIES = 512;
const STATE_REQUEST_MIN_INTERVAL_MS = 120;

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

function clearPendingStateRequests(): void {
  if (pendingStateRequestTimerId !== null) {
    window.clearTimeout(pendingStateRequestTimerId);
    pendingStateRequestTimerId = null;
  }
  pendingStateRequestSections.clear();
}

function flushPendingStateRequest(force = false): void {
  if (!currentRoomId || currentRoomId === '-') {
    clearPendingStateRequests();
    return;
  }

  if (pendingStateRequestSections.size === 0) {
    return;
  }

  const now = Date.now();
  const waitMs = force
    ? 0
    : Math.max(0, STATE_REQUEST_MIN_INTERVAL_MS - (now - lastStateRequestAtMs));
  if (waitMs > 0) {
    if (pendingStateRequestTimerId !== null) {
      return;
    }

    pendingStateRequestTimerId = window.setTimeout(() => {
      pendingStateRequestTimerId = null;
      flushPendingStateRequest();
    }, waitMs);
    return;
  }

  lastStateRequestAtMs = now;
  let requestedSections: NonNullable<StateRequestPayload['sections']> = [
    ...pendingStateRequestSections,
  ];
  pendingStateRequestSections.clear();
  if (requestedSections.includes('full')) {
    requestedSections = ['full'];
  }
  socket.emit('state:request', {
    sections: requestedSections,
  } satisfies StateRequestPayload);
}

function requestStateSections(
  sections: StateRequestPayload['sections'],
  force = false,
): void {
  for (const section of sections ?? ['full']) {
    pendingStateRequestSections.add(section);
  }

  if (force && pendingStateRequestTimerId !== null) {
    window.clearTimeout(pendingStateRequestTimerId);
    pendingStateRequestTimerId = null;
  }

  flushPendingStateRequest(force);
}

function requestStateSnapshot(force = false): void {
  requestStateSections(['full'], force);
}

function applyAuthoritativePlayerIdentity(payload: {
  sessionId: string;
  name: string;
}): void {
  playerIdentityState = applyAuthoritativeIdentity(
    playerIdentityState,
    payload,
  );
  socket.auth = {
    sessionId: playerIdentityState.sessionId,
  };
  try {
    localStorage.setItem(SESSION_STORAGE_KEY, payload.sessionId);
  } catch {
    // Ignore storage failures; reconnect auth still uses in-memory value.
  }
  playerNameEl.value = playerIdentityState.name;
}

function createSyntheticStatePayload(
  payload: RoomStructuresStatePayload,
): RoomStatePayload {
  return {
    roomId: payload.roomId,
    roomName: currentRoomName,
    width: payload.width,
    height: payload.height,
    generation: payload.generation,
    tick: payload.tick,
    grid: new ArrayBuffer(0),
    teams: payload.teams,
  };
}

function shouldApplyCurrentRoomPayload(payloadRoomId: string | null): boolean {
  return shouldApplyRoomScopedPayload(currentRoomId, payloadRoomId);
}

function refreshPreviewAfterAuthoritativeUpdate(
  section: AuthoritativePreviewSection,
  tick: number,
): void {
  if (
    !shouldRefreshAuthoritativePreview({
      section,
      tick,
      hasSelectedPlacement:
        buildModeController.active &&
        buildModeController.candidatePlacement !== null,
      canMutateGameplay: canMutateGameplay(),
      previewPending,
      state: authoritativePreviewRefreshState,
    })
  ) {
    return;
  }

  authoritativePreviewRefreshState = recordAuthoritativePreviewRefresh(
    authoritativePreviewRefreshState,
    section,
    tick,
  );
  emitBuildPreviewForSelectedPlacement();
  refreshBuildPlacementUi();
  requestRender();
}

function applyStatePayload(payload: RoomStatePayload): void {
  const previousGridWidth = gridWidth;
  const previousGridHeight = gridHeight;

  gridWidth = payload.width;
  gridHeight = payload.height;
  gridPackedBytes = payload.grid.slice(0);
  gridBytes = Grid.unpack(gridPackedBytes, gridWidth, gridHeight);
  authoritativeGrid = Grid.fromPacked(gridPackedBytes, gridWidth, gridHeight);
  lastAuthoritativeStateAtMs = Date.now();
  generationEl.textContent = payload.generation.toString();
  if (payload.roomId !== currentRoomId) {
    currentRoomId = payload.roomId;
  }
  if (payload.roomName !== currentRoomName) {
    currentRoomName = payload.roomName;
  }

  updateTeamStats(payload, false);
  syncVisibleStructures(payload, false);
  syncLocalBuildZoneOverlay(payload);
  renderSpawnMarkers(payload);
  resizeCanvas();
  if (gridWidth !== previousGridWidth || gridHeight !== previousGridHeight) {
    resetCameraForCurrentTeam();
  }
  requestRender();
  updateLifecycleUi();

  refreshPreviewAfterAuthoritativeUpdate('full', payload.tick);
}

function applyGridStatePayload(payload: RoomGridStatePayload): void {
  const previousGridWidth = gridWidth;
  const previousGridHeight = gridHeight;

  gridWidth = payload.width;
  gridHeight = payload.height;
  gridPackedBytes = payload.grid.slice(0);
  gridBytes = Grid.unpack(gridPackedBytes, gridWidth, gridHeight);
  authoritativeGrid = Grid.fromPacked(gridPackedBytes, gridWidth, gridHeight);
  lastAuthoritativeStateAtMs = Date.now();
  generationEl.textContent = payload.generation.toString();
  if (payload.roomId !== currentRoomId) {
    currentRoomId = payload.roomId;
  }

  resizeCanvas();
  if (gridWidth !== previousGridWidth || gridHeight !== previousGridHeight) {
    resetCameraForCurrentTeam();
  }
  requestRender();

  refreshPreviewAfterAuthoritativeUpdate('grid', payload.tick);
}

function applyStructuresStatePayload(
  payload: RoomStructuresStatePayload,
): void {
  const syntheticPayload = createSyntheticStatePayload(payload);
  const previousCanMutate = canMutateGameplay();
  const previousDefeatReason = persistentDefeatReason;

  lastAuthoritativeStateAtMs = Date.now();
  updateTeamStats(syntheticPayload, false);
  syncVisibleStructures(syntheticPayload, false);
  syncLocalBuildZoneOverlay(syntheticPayload);
  renderSpawnMarkers(syntheticPayload);
  requestRender();

  if (
    canMutateGameplay() !== previousCanMutate ||
    persistentDefeatReason !== previousDefeatReason
  ) {
    updateLifecycleUi();
  }

  refreshPreviewAfterAuthoritativeUpdate('structures', payload.tick);
}

function getCanvasViewportPoint(event: MouseEvent | PointerEvent): CameraPoint {
  const rect = canvas.getBoundingClientRect();
  return {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
  };
}

function getCanvasViewportCenter(): CameraPoint {
  return {
    x: canvasCssWidth / 2,
    y: canvasCssHeight / 2,
  };
}

function canUseCameraControls(): boolean {
  return Boolean(gridBytes) && matchScreenState.screen === 'ingame';
}

function updateCameraStatus(): void {
  cameraZoomEl.textContent = `Zoom: ${Math.round(cameraState.zoom * 100)}%`;
  gridViewportEl.setAttribute(
    'data-camera-active',
    canUseCameraControls() ? 'true' : 'false',
  );

  if (!gridBytes || matchScreenState.screen !== 'ingame') {
    cameraStatusEl.textContent = 'Camera: waiting for in-match state';
    return;
  }

  if (isCameraPanning) {
    cameraStatusEl.textContent = 'Camera: panning';
    return;
  }

  cameraStatusEl.textContent = `Camera: offset (${Math.round(
    cameraState.offsetX,
  )}, ${Math.round(cameraState.offsetY)})`;
}

function resetCameraForCurrentTeam(): void {
  if (!gridWidth || !gridHeight || !canvasCssWidth || !canvasCssHeight) {
    return;
  }

  cameraState = resetCameraToBase({
    viewport: {
      x: canvasCssWidth,
      y: canvasCssHeight,
    },
    grid: {
      width: gridWidth,
      height: gridHeight,
    },
    cellSize,
    baseTopLeft: latestLocalBaseTopLeft,
    zoom: CAMERA_DEFAULT_ZOOM,
  });
  updateCameraStatus();
}

function isFormElementFocused(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    target.isContentEditable
  );
}

function clearEdgeBannerTimeout(): void {
  if (edgeBannerTimeoutId === null) {
    return;
  }
  window.clearTimeout(edgeBannerTimeoutId);
  edgeBannerTimeoutId = null;
}

function showEdgeBanner(message: string): void {
  edgeBannerEl.textContent = message;
  edgeBannerEl.classList.remove('is-hidden');
  clearEdgeBannerTimeout();
  edgeBannerTimeoutId = window.setTimeout(() => {
    edgeBannerEl.classList.add('is-hidden');
    edgeBannerTimeoutId = null;
  }, SCREEN_TRANSITION_NOTICE_MS);
}

function clearReconnectNoticeTimeout(): void {
  if (reconnectNoticeTimeoutId === null) {
    return;
  }
  window.clearTimeout(reconnectNoticeTimeoutId);
  reconnectNoticeTimeoutId = null;
}

function updateReconnectIndicator(): void {
  const copy = getReconnectNoticeCopy(matchScreenState);
  if (!copy) {
    reconnectIndicatorEl.classList.add('is-hidden');
    reconnectIndicatorEl.textContent = '';
    clearReconnectNoticeTimeout();
    renderTacticalOverlay();
    return;
  }

  reconnectIndicatorEl.textContent = copy;
  reconnectIndicatorEl.classList.remove('is-hidden');

  if (matchScreenState.reconnectNotice === 'synced') {
    clearReconnectNoticeTimeout();
    reconnectNoticeTimeoutId = window.setTimeout(() => {
      matchScreenState = clearReconnectNotice(matchScreenState);
      reconnectNoticeTimeoutId = null;
      updateReconnectIndicator();
    }, RECONNECT_NOTICE_MS);
  }

  renderTacticalOverlay();
}

function updateVisibleMatchScreen(): void {
  const showLobby = matchScreenState.screen === 'lobby';
  lobbyScreenEl.classList.toggle('is-active', showLobby);
  lobbyScreenEl.setAttribute('aria-hidden', showLobby ? 'false' : 'true');
  ingameScreenEl.classList.toggle('is-active', !showLobby);
  ingameScreenEl.setAttribute('aria-hidden', showLobby ? 'true' : 'false');
  updateCameraStatus();
}

function clearBootstrapMembershipTimeout(): void {
  if (bootstrapMembershipTimeoutId === null) {
    return;
  }
  window.clearTimeout(bootstrapMembershipTimeoutId);
  bootstrapMembershipTimeoutId = null;
}

function updateConnectionIssue(
  statusLabel: string,
  lifecycleNotice: string,
  message: string,
  showToast = false,
): void {
  statusEl.textContent = statusLabel;
  lifecycleConnectionNotice = lifecycleNotice;
  connectionIssueVisible = true;
  setMessage(message, true);
  updateLifecycleStatusLine();

  if (showToast && lastConnectionErrorSignature !== message) {
    addToast(message, true);
    lastConnectionErrorSignature = message;
  }
}

function clearConnectionIssue(showRecoveryMessage = false): void {
  const hadIssue = connectionIssueVisible;
  connectionIssueVisible = false;
  lifecycleConnectionNotice = null;
  lastConnectionErrorSignature = null;
  updateLifecycleStatusLine();

  if (showRecoveryMessage && hadIssue) {
    const recoveryMessage =
      'Connection restored. Room membership bootstrap resumed.';
    setMessage(recoveryMessage);
    addToast(recoveryMessage);
  }
}

function scheduleBootstrapMembershipTimeout(): void {
  clearBootstrapMembershipTimeout();
  bootstrapMembershipTimeoutId = window.setTimeout(() => {
    bootstrapMembershipTimeoutId = null;
    if (!socket.connected || currentMembership) {
      return;
    }

    updateConnectionIssue(
      'Connected (bootstrap pending)',
      'connected, waiting for room membership',
      'Connected to server, but room membership bootstrap is taking longer than expected. Waiting for automatic recovery.',
      true,
    );
    socket.emit('room:list');
  }, BOOTSTRAP_MEMBERSHIP_TIMEOUT_MS);
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

  const overflowCount = getChatOverflowCount(
    chatLogEl.childElementCount,
    DEFAULT_CHAT_LOG_MAX_MESSAGES,
  );
  for (let index = 0; index < overflowCount; index += 1) {
    chatLogEl.firstElementChild?.remove();
  }

  chatLogEl.scrollTop = chatLogEl.scrollHeight;
}

function renderLobbyUi(nowMs = Date.now()): void {
  if (!currentMembership) {
    lobbyScreenUi.reset();
    return;
  }

  const membershipViewModel = deriveLobbyMembershipViewModel(
    currentMembership,
    playerIdentityState.sessionId,
    nowMs,
  );
  const controlsViewModel = deriveLobbyControlsViewModel(
    currentMembership,
    playerIdentityState.sessionId,
  );

  lobbyScreenUi.render(membershipViewModel, controlsViewModel);
}

function updateLobbyControls(): void {
  renderLobbyUi();
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

function getSelectedTemplate(): StructureTemplatePayload | null {
  if (!selectedTemplateId) return null;
  return availableTemplates.find(({ id }) => id === selectedTemplateId) ?? null;
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

function describeDestroyFailureReason(reason: string | undefined): string {
  if (reason === 'wrong-owner') {
    return 'wrong owner';
  }
  if (reason === 'invalid-target') {
    return 'invalid target';
  }
  if (reason === 'invalid-lifecycle-state') {
    return 'invalid lifecycle state';
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
  return 'destroy rejected';
}

function resetQueueFeedbackOverride(): void {
  queueFeedbackOverride = null;
}

function setQueueFeedbackOverride(message: string, isError: boolean): void {
  queueFeedbackOverride = { text: message, isError };
}

function resetDestroyFeedbackOverride(): void {
  destroyFeedbackOverride = null;
}

function setDestroyFeedbackOverride(message: string, isError: boolean): void {
  destroyFeedbackOverride = { text: message, isError };
}

function shouldDeduplicateBuildErrorToast(
  payload: RoomErrorPayload,
  message: string,
): boolean {
  if (
    payload.reason !== 'outside-territory' &&
    payload.reason !== 'template-exceeds-map-size' &&
    payload.reason !== 'occupied-site' &&
    payload.reason !== 'unknown-template' &&
    payload.reason !== 'invalid-coordinates' &&
    payload.reason !== 'invalid-delay'
  ) {
    return false;
  }

  const signature = `${payload.reason}:${message}`;
  const now = Date.now();
  if (
    lastBuildErrorToast &&
    lastBuildErrorToast.signature === signature &&
    now - lastBuildErrorToast.at < BUILD_ERROR_TOAST_DEDUPE_MS
  ) {
    return true;
  }

  lastBuildErrorToast = {
    signature,
    at: now,
  };
  return false;
}

function clearSelectedTemplatePlacement(): void {
  buildModeController.clearCandidate();
  latestBuildPreview = null;
  previewPending = false;
  authoritativePreviewRefreshState = createAuthoritativePreviewRefreshState();
  resetQueueFeedbackOverride();
}

function resetDestroyInteractionState(): void {
  destroyViewState = clearDestroySelection(createDestroyViewModelState());
  structureInteractionState = createStructureInteractionState();
  clearStructureHoverTickTimeout();
  visibleStructures = [];
  structureCellIndex = new Map<string, VisibleStructure>();
  clearLocalBuildZoneOverlay();
  resetDestroyFeedbackOverride();
  renderStructureInspector();
}

function mapVisibleStructureToSelectable(
  structure: VisibleStructure,
): DestroySelectableStructure {
  return {
    key: structure.key,
    teamId: structure.teamId,
    templateName: structure.templateName,
    requiresDestroyConfirm: structure.requiresDestroyConfirm,
  };
}

function getVisibleStructureByKey(key: string): VisibleStructure | null {
  return visibleStructures.find((structure) => structure.key === key) ?? null;
}

function getStructureAtCell(cell: Cell): VisibleStructure | null {
  return structureCellIndex.get(`${cell.x},${cell.y}`) ?? null;
}

function clearStructureHoverTickTimeout(): void {
  if (structureHoverTickTimeoutId === null) {
    return;
  }

  window.clearTimeout(structureHoverTickTimeoutId);
  structureHoverTickTimeoutId = null;
}

function scheduleStructureHoverTick(nowMs: number): void {
  clearStructureHoverTickTimeout();

  if (
    structureInteractionState.pinnedKey ||
    !structureInteractionState.hoverKey ||
    structureInteractionState.hoverLeaveExpiresAtMs === null
  ) {
    return;
  }

  const delayMs = Math.max(
    0,
    structureInteractionState.hoverLeaveExpiresAtMs - nowMs,
  );

  structureHoverTickTimeoutId = window.setTimeout(() => {
    structureHoverTickTimeoutId = null;
    const tickNow = Date.now();
    structureInteractionState = reduceStructureInteraction(
      structureInteractionState,
      {
        type: 'tick',
        atMs: tickNow,
      },
    );
    syncDestroySelectionFromInteraction(tickNow);
    renderStructureInspector(tickNow);
    refreshActionUi(tickNow);
  }, delayMs);
}

function syncDestroySelectionFromInteraction(nowMs: number): void {
  const activeKey = selectActiveStructureKey(structureInteractionState, nowMs);
  if (
    !activeKey ||
    !canShowStructureActions(structureInteractionState, nowMs)
  ) {
    destroyViewState = clearDestroySelection(destroyViewState);
    return;
  }

  const activeStructure = getVisibleStructureByKey(activeKey);
  if (!activeStructure) {
    destroyViewState = clearDestroySelection(destroyViewState);
    return;
  }

  destroyViewState = refreshDestroySelection(
    destroyViewState,
    mapVisibleStructureToSelectable(activeStructure),
    currentTeamId,
  );
}

function renderStructureInspector(nowMs = Date.now()): void {
  const mode = selectStructureInteractionMode(structureInteractionState, nowMs);
  const activeKey = selectActiveStructureKey(structureInteractionState, nowMs);
  const activeStructure = activeKey
    ? getVisibleStructureByKey(activeKey)
    : null;

  if (!activeStructure) {
    structureInspectorStatusEl.textContent =
      'Hover a structure to inspect details. Click or tap to pin and unlock actions.';
    structureInspectorTemplateEl.textContent = '-';
    structureInspectorOwnerEl.textContent = '-';
    structureInspectorHealthEl.textContent = '-';
    structureInspectorStateEl.textContent = '-';
    structureInspectorStatusEl.classList.remove('inspector-status--pinned');
    return;
  }

  structureInspectorTemplateEl.textContent = activeStructure.templateName;
  structureInspectorOwnerEl.textContent =
    currentTeamId !== null && activeStructure.teamId === currentTeamId
      ? `Team ${activeStructure.teamId} (you)`
      : `Team ${activeStructure.teamId}`;
  structureInspectorHealthEl.textContent = `${activeStructure.hp} HP`;
  structureInspectorStateEl.textContent = activeStructure.active
    ? 'Active'
    : 'Inactive';

  if (mode === 'pinned') {
    structureInspectorStatusEl.textContent =
      'Pinned structure. Actions and outcomes stay anchored here.';
  } else {
    structureInspectorStatusEl.textContent =
      'Hover preview only. Click or tap to pin this structure for actions.';
  }

  structureInspectorStatusEl.classList.toggle(
    'inspector-status--pinned',
    mode === 'pinned',
  );
}

function applyStructureInteraction(
  action: StructureInteractionAction,
  nowMs = Date.now(),
): void {
  const previousState = structureInteractionState;
  const nextState = reduceStructureInteraction(previousState, action);
  const interactionChanged =
    previousState.hoverKey !== nextState.hoverKey ||
    previousState.pinnedKey !== nextState.pinnedKey ||
    previousState.hoverLeaveExpiresAtMs !== nextState.hoverLeaveExpiresAtMs;

  structureInteractionState = nextState;
  if (!interactionChanged) {
    return;
  }

  syncDestroySelectionFromInteraction(nowMs);
  scheduleStructureHoverTick(nowMs);
  renderStructureInspector(nowMs);
  refreshActionUi(nowMs);
}

function updateStructureHoverStateForPointer(event: PointerEvent): void {
  if (!gridBytes || matchScreenState.screen !== 'ingame') {
    return;
  }

  const nowMs = Date.now();
  structureInteractionState = reduceStructureInteraction(
    structureInteractionState,
    {
      type: 'tick',
      atMs: nowMs,
    },
  );

  const cell = pointerToCell(event);
  const structure = cell ? getStructureAtCell(cell) : null;
  if (structure) {
    applyStructureInteraction(
      {
        type: 'hover-enter',
        structureKey: structure.key,
      },
      nowMs,
    );
    return;
  }

  applyStructureInteraction(
    {
      type: 'hover-leave',
      atMs: nowMs,
      graceMs: DEFAULT_HOVER_LEAVE_GRACE_MS,
    },
    nowMs,
  );
}

function clearTacticalOverlayTickTimeout(): void {
  if (tacticalOverlayTickTimeoutId === null) {
    return;
  }

  window.clearTimeout(tacticalOverlayTickTimeoutId);
  tacticalOverlayTickTimeoutId = null;
}

function scheduleTacticalOverlayTick(nowMs: number): void {
  clearTacticalOverlayTickTimeout();

  let nextTickAt: number | null = null;
  for (const highlightUntil of Object.values(
    tacticalOverlayState.highlightUntilByMetric,
  )) {
    if (highlightUntil > nowMs) {
      nextTickAt =
        nextTickAt === null
          ? highlightUntil
          : Math.min(nextTickAt, highlightUntil);
    }
  }

  if (
    lastAuthoritativeStateAtMs !== null &&
    !hasVisibleReconnectNotice(matchScreenState)
  ) {
    const staleTickAt =
      lastAuthoritativeStateAtMs + DEFAULT_SYNC_STALE_THRESHOLD_MS + 1;
    if (staleTickAt > nowMs) {
      nextTickAt =
        nextTickAt === null ? staleTickAt : Math.min(nextTickAt, staleTickAt);
    }
  }

  if (nextTickAt === null) {
    return;
  }

  tacticalOverlayTickTimeoutId = window.setTimeout(
    () => {
      tacticalOverlayTickTimeoutId = null;
      renderTacticalOverlay(Date.now());
    },
    Math.max(0, nextTickAt - nowMs),
  );
}

function setOverlayPendingBadge(
  element: HTMLElement,
  pendingCount: number,
): void {
  if (pendingCount <= 0) {
    element.classList.add('is-hidden');
    element.textContent = 'Pending';
    return;
  }

  element.classList.remove('is-hidden');
  element.textContent = `Pending ${pendingCount}`;
}

function renderTacticalSummaryItems(
  container: HTMLElement,
  items: readonly TacticalOverlaySummaryItem[],
): void {
  container.innerHTML = '';

  if (items.length === 0) {
    return;
  }

  for (const item of items) {
    const card = document.createElement('article');
    card.className = 'tactical-summary-item';
    card.classList.toggle('tactical-summary-item--highlight', item.highlighted);

    const labelEl = document.createElement('span');
    labelEl.textContent = item.label;
    const valueEl = document.createElement('strong');
    valueEl.textContent = item.value;

    card.append(labelEl, valueEl);
    container.append(card);
  }
}

function renderTacticalDetailRows(
  container: HTMLElement,
  rows: readonly TacticalOverlayDetailRow[],
): void {
  container.innerHTML = '';

  for (const row of rows) {
    const rowEl = document.createElement('div');
    rowEl.className = 'tactical-detail-row';

    const labelEl = document.createElement('span');
    labelEl.textContent = row.label;
    const valueEl = document.createElement('strong');
    valueEl.textContent = row.value;

    rowEl.append(labelEl, valueEl);
    container.append(rowEl);
  }
}

function renderOverlayFeedbackRows(): void {
  overlayFeedbackBuildEl.textContent = overlayBuildFeedbackCopy;
  overlayFeedbackBuildEl.classList.toggle(
    'section-feedback--pending',
    overlayBuildFeedbackPending,
  );
  overlayFeedbackBuildEl.classList.toggle(
    'queue-feedback--error',
    overlayBuildFeedbackIsError,
  );

  overlayFeedbackTeamEl.textContent = overlayTeamFeedbackCopy;
  overlayFeedbackTeamEl.classList.toggle(
    'section-feedback--pending',
    overlayTeamFeedbackPending,
  );
  overlayFeedbackTeamEl.classList.toggle(
    'queue-feedback--error',
    overlayTeamFeedbackIsError,
  );
}

function setActiveOverlayTab(tabId: 'economy' | 'build' | 'team'): void {
  activeOverlayTab = tabId;
  tacticalRailEl.dataset.mobileTab = tabId;

  const tabs = [
    { id: 'economy', button: overlayTabEconomyButton },
    { id: 'build', button: overlayTabBuildButton },
    { id: 'team', button: overlayTabTeamButton },
  ] as const;

  for (const tab of tabs) {
    const isActive = tab.id === tabId;
    tab.button.classList.toggle('is-active', isActive);
    tab.button.setAttribute('aria-selected', isActive ? 'true' : 'false');
  }
}

function toTacticalOverlayTeamSnapshot(
  team: TeamPayload | null,
): TacticalOverlayTeamSnapshot | null {
  if (!team) {
    return null;
  }

  return {
    id: team.id,
    name: `Team ${team.id}`,
    defeated: team.defeated,
    baseIntact: team.baseIntact,
    resources: team.resources,
    income: team.income,
    incomeBreakdown: team.incomeBreakdown,
    pendingBuilds: team.pendingBuilds,
    pendingDestroys: team.pendingDestroys,
    structures: team.structures.map((structure) => ({
      key: structure.key,
      active: structure.active,
    })),
  };
}

function renderTacticalSection(
  section: TacticalOverlaySection | undefined,
  summaryEl: HTMLElement,
  detailEl: HTMLElement,
): void {
  if (!section) {
    summaryEl.innerHTML = '';
    detailEl.innerHTML = '';
    return;
  }

  renderTacticalSummaryItems(summaryEl, section.summaryItems);
  renderTacticalDetailRows(detailEl, section.detailRows);
}

function renderTacticalOverlay(nowMs = Date.now()): void {
  tacticalOverlayState = deriveTacticalOverlayState(tacticalOverlayState, {
    nowMs,
    team: toTacticalOverlayTeamSnapshot(latestTacticalTeamSnapshot),
    templates: availableTemplates,
    selectedTemplateId: selectedTemplateId || null,
    previewReasonCopy: previewReasonEl.textContent,
    latestActionCopy: overlayTeamFeedbackCopy,
    sync: {
      reconnectPending: isReconnectSyncing(matchScreenState),
      lastAuthoritativeUpdateAtMs: lastAuthoritativeStateAtMs,
      staleThresholdMs: DEFAULT_SYNC_STALE_THRESHOLD_MS,
      hintCopy: 'Syncing tactical data from server updates...',
    },
  });

  const sections = new Map(
    tacticalOverlayState.sections.map((section) => [section.id, section]),
  );
  const economySection = sections.get('economy');
  const buildSection = sections.get('build');
  const teamSection = sections.get('team');

  renderTacticalSection(
    economySection,
    overlaySummaryEconomyEl,
    overlayDetailsEconomyEl,
  );
  renderTacticalSection(
    buildSection,
    overlaySummaryBuildEl,
    overlayDetailsBuildEl,
  );
  renderTacticalSection(
    teamSection,
    overlaySummaryTeamEl,
    overlayDetailsTeamEl,
  );

  const buildPendingCount =
    (buildSection?.pendingBadgeCount ?? 0) +
    (overlayBuildFeedbackPending ? 1 : 0);
  const teamPendingCount =
    (teamSection?.pendingBadgeCount ?? 0) +
    (overlayTeamFeedbackPending ? 1 : 0);

  setOverlayPendingBadge(
    overlayPendingEconomyEl,
    economySection?.pendingBadgeCount ?? 0,
  );
  setOverlayPendingBadge(overlayPendingBuildEl, buildPendingCount);
  setOverlayPendingBadge(overlayPendingTeamEl, teamPendingCount);

  if (tacticalOverlayState.syncHint.visible) {
    tacticalSyncHintEl.classList.remove('is-hidden');
    tacticalSyncHintEl.textContent =
      tacticalOverlayState.syncHint.copy ?? 'Syncing tactical data...';
  } else {
    tacticalSyncHintEl.classList.add('is-hidden');
    tacticalSyncHintEl.textContent = '';
  }

  renderOverlayFeedbackRows();
  scheduleTacticalOverlayTick(nowMs);
}

function resetTacticalOverlayState(): void {
  clearTacticalOverlayTickTimeout();
  tacticalOverlayState = createTacticalOverlayState();
  latestTacticalTeamSnapshot = null;
  lastAuthoritativeStateAtMs = null;
  overlayBuildFeedbackCopy = 'No recent build action.';
  overlayBuildFeedbackPending = false;
  overlayBuildFeedbackIsError = false;
  overlayTeamFeedbackCopy = 'No recent team action.';
  overlayTeamFeedbackPending = false;
  overlayTeamFeedbackIsError = false;
  renderTacticalOverlay();
}

function resetRoomTransitionFlags(): void {
  countdownSecondsRemaining = null;
  currentMatchFinished = null;
  isFinishedPanelMinimized = false;
  currentTeamDefeated = false;
  persistentDefeatReason = null;
  latestOutcomeTimelineMetadata = null;
  currentMembership = null;
  lastBuildErrorToast = null;
}

function resetRoomTransitionViewModels(): void {
  clearSelectedTemplatePlacement();
  resetEconomyTracking();
  resetDestroyInteractionState();
  resetTacticalOverlayState();
}

function syncVisibleStructures(
  payload: RoomStatePayload,
  refreshUi = true,
): void {
  const nextStructures: VisibleStructure[] = [];
  const nextIndex = new Map<string, VisibleStructure>();
  const nextTeamBuildZoneProjectionInputs = new Map<
    number,
    TeamBuildZoneProjectionInput[]
  >();

  const sortedTeams = [...payload.teams].sort(
    (left, right) => left.id - right.id,
  );
  for (const team of sortedTeams) {
    for (const structure of team.structures) {
      const visible: VisibleStructure = {
        teamId: team.id,
        key: structure.key,
        templateId: structure.templateId,
        templateName: structure.templateName,
        x: structure.x,
        y: structure.y,
        width: structure.width,
        height: structure.height,
        hp: structure.hp,
        active: structure.active,
        isCore: structure.isCore,
        requiresDestroyConfirm: structure.requiresDestroyConfirm,
        footprint: structure.footprint,
      };
      nextStructures.push(visible);

      const teamBuildZoneProjectionInputs =
        nextTeamBuildZoneProjectionInputs.get(team.id) ?? [];
      teamBuildZoneProjectionInputs.push({
        x: visible.x,
        y: visible.y,
        width: visible.width,
        height: visible.height,
        hp: visible.hp,
      });
      if (!nextTeamBuildZoneProjectionInputs.has(team.id)) {
        nextTeamBuildZoneProjectionInputs.set(
          team.id,
          teamBuildZoneProjectionInputs,
        );
      }

      for (const footprintCell of visible.footprint) {
        const indexKey = `${footprintCell.x},${footprintCell.y}`;
        if (!nextIndex.has(indexKey)) {
          nextIndex.set(indexKey, visible);
        }
      }
    }
  }

  visibleStructures = nextStructures;
  structureCellIndex = nextIndex;
  teamBuildZoneProjectionInputsByTeamId = nextTeamBuildZoneProjectionInputs;

  structureInteractionState = reduceStructureInteraction(
    structureInteractionState,
    {
      type: 'reconcile',
      availableStructureKeys: nextStructures.map((structure) => structure.key),
    },
  );

  const pendingForTeam =
    payload.teams.find(({ id }) => id === currentTeamId)?.pendingDestroys ?? [];
  destroyViewState = syncDestroyPending(
    destroyViewState,
    pendingForTeam.map(({ structureKey }) => structureKey),
  );

  const nowMs = Date.now();
  syncDestroySelectionFromInteraction(nowMs);
  scheduleStructureHoverTick(nowMs);
  renderStructureInspector(nowMs);
  if (refreshUi) {
    refreshActionUi(nowMs);
  }
}

function cellKey(x: number, y: number): number {
  return y * gridWidth + x;
}

function clearLocalBuildZoneOverlay(): void {
  localBuildZoneCells = [];
  localBuildZoneCellKeys = new Set<number>();
  localBuildZoneSignature = '';
  localBuildZoneCoverageCache.clear();
}

function syncLocalBuildZoneOverlay(payload: RoomStatePayload): void {
  if (currentTeamId === null) {
    clearLocalBuildZoneOverlay();
    return;
  }

  const localTeam = payload.teams.find((team) => team.id === currentTeamId);
  if (!localTeam) {
    clearLocalBuildZoneOverlay();
    return;
  }

  const overlayProjection = computeLocalBuildZoneOverlay({
    structures: localTeam.structures,
    gridWidth,
    gridHeight,
    previousSignature: localBuildZoneSignature,
    coverageCache: localBuildZoneCoverageCache,
    maxCoverageCacheEntries: LOCAL_BUILD_ZONE_CACHE_MAX_ENTRIES,
  });

  if (!overlayProjection.changed) {
    return;
  }

  localBuildZoneSignature = overlayProjection.signature;
  localBuildZoneCellKeys = new Set(overlayProjection.cellKeys);
  localBuildZoneCells = overlayProjection.cellKeys.map((key) => ({
    x: key % gridWidth,
    y: Math.floor(key / gridWidth),
  }));
}

function selectDestroyStructureAtCell(cell: Cell): boolean {
  const structure = getStructureAtCell(cell);
  if (!structure) {
    return false;
  }

  const nowMs = Date.now();
  if (structureInteractionState.pinnedKey === structure.key) {
    applyStructureInteraction({ type: 'unpin' }, nowMs);
    resetDestroyFeedbackOverride();
    setMessage(
      `Unpinned ${structure.templateName} (${structure.key}). Hover to inspect, pin to act.`,
    );
    return true;
  }

  applyStructureInteraction(
    {
      type: 'pin',
      structureKey: structure.key,
    },
    nowMs,
  );
  resetDestroyFeedbackOverride();

  const ownerLabel =
    currentTeamId !== null && structure.teamId === currentTeamId
      ? 'owned'
      : `team ${structure.teamId}`;
  setMessage(
    `Pinned ${structure.templateName} (${structure.key}) [${ownerLabel}] for inspector actions.`,
  );
  return true;
}

function updateDestroyUi(nowMs = Date.now()): void {
  const canUsePinnedActions = canShowStructureActions(
    structureInteractionState,
    nowMs,
  );
  const activeKey = selectActiveStructureKey(structureInteractionState, nowMs);
  const activeStructure = activeKey
    ? getVisibleStructureByKey(activeKey)
    : null;

  destroyQueueButton.hidden = false;
  destroyConfirmPanelEl.hidden = true;
  destroyQueueButton.disabled = true;
  destroyConfirmButton.disabled = true;
  destroyCancelButton.disabled = true;
  destroyConfirmButton.textContent = 'Arm Confirm Destroy';

  const selectedKey = destroyViewState.selectedKey;
  const selectedStructure = selectedKey
    ? getVisibleStructureByKey(selectedKey)
    : null;

  let selectionCopy = activeStructure
    ? `Inspecting: ${activeStructure.templateName} (${activeStructure.key})`
    : 'Select a structure on the board to enable destroy actions.';
  if (selectedStructure && canUsePinnedActions) {
    selectionCopy = `Pinned: ${selectedStructure.templateName} (${selectedStructure.key})`;
  }
  destroySelectionEl.textContent = selectionCopy;

  let feedback = 'Pin an owned structure to enable destroy actions.';
  let isError = false;
  let actionHint = 'Pin an owned structure to queue destroy actions.';
  let actionHintPending = false;

  if (!canUsePinnedActions) {
    destroyQueueButton.hidden = true;
    destroyConfirmPanelEl.hidden = true;

    if (activeStructure) {
      feedback = 'Hover preview is read-only. Click or tap to pin for actions.';
      actionHint =
        'Hover preview active. Pin this structure to unlock queue controls.';
    } else {
      feedback = 'Hover or pin a structure to inspect destroy options.';
    }

    if (destroyFeedbackOverride) {
      feedback = destroyFeedbackOverride.text;
      isError = destroyFeedbackOverride.isError;
    }

    structureInspectorActionHintEl.textContent = actionHint;
    structureInspectorActionHintEl.classList.toggle(
      'inspector-action-hint--pending',
      false,
    );
    destroyFeedbackEl.textContent = feedback;
    destroyFeedbackEl.classList.toggle('queue-feedback--error', isError);
    overlayTeamFeedbackCopy = feedback;
    overlayTeamFeedbackIsError = isError;
    return;
  }

  if (!canMutateGameplay()) {
    feedback =
      'Destroy action is read-only until you are an active, non-defeated player.';
    actionHint =
      'Pinned in read-only mode. Actions unlock when you are active and alive.';
  } else if (!selectedStructure) {
    feedback =
      'Select any structure cell on the board to inspect destroy actions.';
    actionHint = 'Pinned structure not found in latest state. Re-pin a target.';
  } else if (!destroyViewState.selectedOwned) {
    feedback = 'Destroy controls are hidden for non-owned structures.';
    isError = true;
    actionHint = 'Pinned structure is not owned by your team.';
  } else if (
    destroyViewState.pendingStructureKeys.includes(selectedStructure.key)
  ) {
    feedback =
      'Destroy pending for selected structure. You may retarget another structure.';
    actionHint = 'Destroy request pending for this structure.';
    actionHintPending = true;
  } else if (selectedStructure.requiresDestroyConfirm) {
    destroyQueueButton.hidden = true;
    destroyConfirmPanelEl.hidden = false;
    destroyConfirmButton.disabled = false;
    destroyCancelButton.disabled = !destroyViewState.confirmArmed;
    destroyConfirmButton.textContent = destroyViewState.confirmArmed
      ? 'Confirm Destroy Now'
      : 'Arm Confirm Destroy';
    feedback = destroyViewState.confirmArmed
      ? 'Confirm destroy to submit the coordinated request.'
      : 'Core destroy requires confirmation before queue submission.';
    actionHint = destroyViewState.confirmArmed
      ? 'Confirm armed. Submit destroy to queue the request.'
      : 'Core structures require one extra confirmation step.';
  } else {
    destroyQueueButton.disabled = false;
    feedback = 'Ready to queue destroy request for selected structure.';
    actionHint = 'Pinned and owned. Destroy action is ready.';
  }

  if (destroyFeedbackOverride) {
    feedback = destroyFeedbackOverride.text;
    isError = destroyFeedbackOverride.isError;
    actionHint = destroyFeedbackOverride.text;
    actionHintPending = !destroyFeedbackOverride.isError;
  }

  structureInspectorActionHintEl.textContent = actionHint;
  structureInspectorActionHintEl.classList.toggle(
    'inspector-action-hint--pending',
    actionHintPending,
  );
  destroyFeedbackEl.textContent = feedback;
  destroyFeedbackEl.classList.toggle('queue-feedback--error', isError);
  overlayTeamFeedbackCopy = feedback;
  overlayTeamFeedbackIsError = isError;
}

function updateTransformIndicator(): void {
  transformIndicatorEl.textContent = formatPlacementTransformIndicator(
    placementTransformState,
  );
}

function updateQueueAffordabilityUi(): void {
  const queueUi = deriveBuildQueueUi({
    selectedTemplateId: selectedTemplateId || null,
    buildModeActive: buildModeController.active,
    selectedPlacement: buildModeController.candidatePlacement,
    latestBuildPreview,
    activeTransformOperations: placementTransformState.operations,
    previewPending,
    canMutateGameplay: canMutateGameplay(),
    queueFeedbackOverride,
  });

  queuePlacementEl.textContent = queueUi.placementCopy;
  previewReasonEl.textContent = queueUi.previewReasonCopy;
  previewReasonEl.classList.toggle(
    'queue-feedback--error',
    queueUi.previewReasonIsError,
  );

  queueCostEl.classList.remove('queue-cost--affordable', 'queue-cost--blocked');
  queueCostEl.textContent = queueUi.queueCostCopy;
  if (queueUi.queueCostTone !== 'neutral') {
    queueCostEl.classList.add(
      queueUi.queueCostTone === 'affordable'
        ? 'queue-cost--affordable'
        : 'queue-cost--blocked',
    );
  }

  queueFeedbackEl.textContent = queueUi.queueFeedbackCopy;
  queueFeedbackEl.classList.toggle(
    'queue-feedback--error',
    queueUi.queueFeedbackIsError,
  );
  overlayBuildFeedbackCopy = queueUi.queueFeedbackCopy;
  overlayBuildFeedbackIsError = queueUi.queueFeedbackIsError;
}

function refreshActionUi(nowMs = Date.now()): void {
  updateQueueAffordabilityUi();
  updateDestroyUi(nowMs);
  renderOverlayFeedbackRows();
  renderTacticalOverlay(nowMs);
}

function refreshBuildPlacementUi(): void {
  updateQueueAffordabilityUi();
  renderOverlayFeedbackRows();
}

function syncPreviewTemplateSnapshots(
  templates: readonly StructureTemplatePayload[],
): void {
  previewTemplateSnapshotsById.clear();

  for (const template of templates) {
    previewTemplateSnapshotsById.set(template.id, {
      width: template.width,
      height: template.height,
      grid: Grid.fromPacked(
        Uint8Array.from(template.cells),
        template.width,
        template.height,
      ),
      checks: template.checks.map((check) => ({ x: check.x, y: check.y })),
      activationCost: template.activationCost,
    });
  }
}

function deriveLocalBuildPreview(
  previewRequest: Exclude<
    ReturnType<typeof buildPreviewRequestFromSelection>,
    null
  >,
): BuildPreview | null {
  if (currentRoomId === '-' || currentTeamId === null || !authoritativeGrid) {
    return null;
  }

  const currentTeam = latestTacticalTeamSnapshot;
  if (!currentTeam || currentTeam.id !== currentTeamId) {
    return null;
  }

  const teamBuildZoneProjectionInputs =
    teamBuildZoneProjectionInputsByTeamId.get(currentTeamId) ?? [];

  const previewResult = RtsEngine.previewBuildPlacementFromSnapshot({
    width: gridWidth,
    height: gridHeight,
    grid: authoritativeGrid,
    teamResources: currentTeam.resources,
    teamDefeated: currentTeam.defeated,
    teamBuildZoneProjectionInputs,
    template:
      previewTemplateSnapshotsById.get(previewRequest.templateId) ?? null,
    x: previewRequest.x,
    y: previewRequest.y,
    transform: previewRequest.transform,
  });

  return {
    templateId: previewRequest.templateId,
    x: previewRequest.x,
    y: previewRequest.y,
    transform: previewResult.transform,
    footprint: previewResult.footprint,
    illegalCells: previewResult.illegalCells,
    bounds: previewResult.bounds,
    reason: previewResult.reason,
    affordable: previewResult.affordable ?? false,
    needed: previewResult.needed ?? 0,
    current: previewResult.current ?? currentTeam.resources,
    deficit: previewResult.deficit ?? 0,
  };
}

function emitBuildPreviewForSelectedPlacement(): void {
  if (!canMutateGameplay()) {
    return;
  }

  const previewRequest = buildPreviewRequestFromSelection(
    buildModeController.candidatePlacement,
    toPlacementTransformInput(placementTransformState),
  );
  if (!previewRequest) {
    return;
  }

  resetQueueFeedbackOverride();
  previewPending = false;
  latestBuildPreview = deriveLocalBuildPreview(previewRequest);
}

function emitDestroyQueueForSelection(): void {
  if (!canMutateGameplay()) {
    setMessage('Destroy controls are disabled in read-only mode.', true);
    return;
  }

  const structureKey = destroyViewState.selectedKey;
  if (!structureKey || !canQueueDestroy(destroyViewState)) {
    refreshActionUi();
    return;
  }

  resetDestroyFeedbackOverride();
  setDestroyFeedbackOverride('Submitting destroy request...', false);
  overlayTeamFeedbackPending = true;
  overlayTeamFeedbackIsError = false;
  overlayTeamFeedbackCopy = 'Submitting destroy request...';
  socket.emit('destroy:queue', {
    structureKey,
  });
  refreshActionUi();
}

function applyTransformControl(
  operation: 'rotate' | 'mirror-horizontal' | 'mirror-vertical',
  label: string,
): void {
  if (!canMutateGameplay()) {
    setMessage('Transform controls are disabled in read-only mode.', true);
    return;
  }

  if (!buildModeController.active) {
    setMessage('Enter build mode before applying placement transforms.', true);
    return;
  }

  placementTransformState = applyPlacementTransformOperation(
    placementTransformState,
    operation,
  );
  updateTransformIndicator();
  setMessage(`${label} applied. Preview updated locally.`);
  emitBuildPreviewForSelectedPlacement();
  requestRender();
  refreshActionUi();
}

function resetEconomyTracking(): void {
  economyHudController.reset();
}

function syncEconomyHud(team: TeamPayload | null, tick: number): void {
  economyHudController.sync(team, tick);
}

function updateTemplateButtonMenu(): void {
  if (availableTemplates.length === 0) {
    selectedTemplateId = '';
    buildModeController.deactivate();
    clearSelectedTemplatePlacement();
    templateButtonMenu.update({
      templates: [],
      selectedTemplateId: null,
      buildModeActive: false,
      enabled: false,
    });
    return;
  }

  if (!selectedTemplateId || !getSelectedTemplate()) {
    selectedTemplateId = availableTemplates[0]?.id ?? '';
    clearSelectedTemplatePlacement();
  }

  templateButtonMenu.update({
    templates: availableTemplates,
    selectedTemplateId,
    buildModeActive: buildModeController.active,
    enabled: canMutateGameplay(),
  });
}

function setBuildCandidateFromCell(cell: Cell): boolean {
  const template = getSelectedTemplate();
  if (!template || !buildModeController.active) {
    return false;
  }

  const candidateUpdate = buildModeController.updateCandidateForCell(
    template,
    cell,
  );
  if (!candidateUpdate.changed) {
    return false;
  }

  authoritativePreviewRefreshState = createAuthoritativePreviewRefreshState();
  resetQueueFeedbackOverride();
  emitBuildPreviewForSelectedPlacement();
  refreshBuildPlacementUi();
  requestRender();
  return true;
}

function exitBuildMode(announce = true): void {
  if (!buildModeController.active) {
    if (announce) {
      setMessage('Build mode is already inactive.');
    }
    return;
  }

  buildModeController.deactivate();
  clearSelectedTemplatePlacement();
  updateTemplateButtonMenu();
  requestRender();
  refreshActionUi();
  if (announce) {
    setMessage('Build mode exited.');
  }
}

function activateBuildModeForTemplate(templateId: string): void {
  if (!canMutateGameplay()) {
    setMessage('Build controls are read-only until the match is active.', true);
    return;
  }

  if (!currentRoomId || currentRoomId === '-') {
    setMessage('Join a room before entering build mode.', true);
    return;
  }

  const template = availableTemplates.find((entry) => entry.id === templateId);
  if (!template) {
    setMessage('Selected template is no longer available.', true);
    return;
  }

  const switchedTemplate = selectedTemplateId !== templateId;
  selectedTemplateId = templateId;
  buildModeController.activate();
  if (switchedTemplate) {
    clearSelectedTemplatePlacement();
  }

  const hasCandidate =
    buildModeController.lastHoveredCell !== null &&
    setBuildCandidateFromCell(buildModeController.lastHoveredCell);

  updateTemplateButtonMenu();
  requestRender();
  refreshActionUi();
  if (hasCandidate) {
    setMessage(
      `Build mode active for ${template.name}. Click the grid to queue placement.`,
    );
    return;
  }

  setMessage(`Build mode active for ${template.name}. Move cursor to preview.`);
}

function getSelfParticipant(): MembershipParticipant | null {
  return selectSelfParticipant(
    currentMembership,
    playerIdentityState.sessionId,
  );
}

function isCurrentUserHost(): boolean {
  return selectIsHost(currentMembership, playerIdentityState.sessionId);
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

  if (!gameplayAllowed && buildModeController.active) {
    buildModeController.deactivate();
    clearSelectedTemplatePlacement();
  }

  buildDelayEl.disabled = !gameplayAllowed;
  transformRotateButton.disabled =
    !gameplayAllowed || !buildModeController.active;
  transformMirrorHorizontalButton.disabled =
    !gameplayAllowed || !buildModeController.active;
  transformMirrorVerticalButton.disabled =
    !gameplayAllowed || !buildModeController.active;
  exitBuildModeButton.disabled =
    !gameplayAllowed || !buildModeController.active;
  destroyQueueButton.disabled = !gameplayAllowed;
  destroyConfirmButton.disabled = !gameplayAllowed;
  destroyCancelButton.disabled = !gameplayAllowed;
  canvas.classList.toggle('canvas--locked', !gameplayAllowed);
  canvas.setAttribute('aria-disabled', gameplayAllowed ? 'false' : 'true');
  updateTemplateButtonMenu();

  const bannerCopy = getReadOnlyBannerCopy();
  spectatorBannerEl.classList.toggle('is-hidden', bannerCopy === null);

  if (!bannerCopy) {
    refreshActionUi();
    return;
  }

  spectatorBannerEl.classList.toggle(
    'spectator-banner--defeated',
    bannerCopy.defeated,
  );
  spectatorBannerTitleEl.textContent = bannerCopy.title;
  spectatorBannerTextEl.textContent = bannerCopy.text;
  refreshActionUi();
}

function syncCurrentTeamIdFromState(payload: RoomStatePayload): void {
  currentTeamId = resolveTeamIdForSession(
    payload.teams,
    playerIdentityState.sessionId,
  );
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
  const finishedVisible = currentRoomStatus === 'finished';

  finishedPanelEl.classList.toggle('is-hidden', !finishedVisible);
  finishedPanelEl.classList.toggle(
    'finished-panel--minimized',
    isFinishedPanelMinimized,
  );
  finishedPanelEl.dataset.timelineMetadata = latestOutcomeTimelineMetadata
    ? 'available'
    : 'none';

  finishedMinimizeButton.textContent = isFinishedPanelMinimized
    ? 'Expand'
    : 'Minimize';

  const isHost = isCurrentUserHost();
  restartMatchButton.disabled = !isHost;
  restartStatusEl.textContent = isHost
    ? 'Host controls restart. Countdown starts immediately when pressed.'
    : 'Waiting for host to restart this finished match.';
}

function updateLifecycleStatusLine(): void {
  const baseLabel = `Lifecycle: ${getLifecycleLabel(currentRoomStatus)}`;
  lifecycleStatusLineEl.textContent = lifecycleConnectionNotice
    ? `${baseLabel} | ${lifecycleConnectionNotice}`
    : baseLabel;
}

function updateLifecycleUi(): void {
  updateLifecycleStatusLine();
  updateCountdownOverlay();
  updateFinishedPanelState();
  updateReadOnlyExperience();
}

function applyRoomStatus(nextStatus: RoomStatus): void {
  const previousStatus = currentRoomStatus;
  const resolution = applyAuthoritativeStatus(matchScreenState, nextStatus);
  matchScreenState = resolution.state;
  currentRoomStatus = resolution.state.status;

  if (nextStatus !== 'finished') {
    isFinishedPanelMinimized = false;
  }

  if (previousStatus === 'finished' && nextStatus === 'countdown') {
    currentMatchFinished = null;
    currentTeamDefeated = false;
    persistentDefeatReason = null;
    latestOutcomeTimelineMetadata = null;
    renderFinishedResults();
  }

  updateVisibleMatchScreen();
  if (resolution.transitionBannerCopy) {
    showEdgeBanner(resolution.transitionBannerCopy);
  }
  updateReconnectIndicator();

  updateLifecycleUi();
}

function renderRoomList(rooms: RoomListEntryPayload[]): void {
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

function chooseCellSize(width: number): number {
  const viewportWidth =
    gridViewportEl.clientWidth > 0
      ? gridViewportEl.clientWidth
      : window.innerWidth;
  return chooseGridCellSize(width, viewportWidth);
}

function resizeCanvas(): void {
  if (!gridWidth || !gridHeight) return;

  cellSize = chooseCellSize(gridWidth);
  canvasRatio = window.devicePixelRatio || 1;
  canvasCssWidth = gridWidth * cellSize;
  canvasCssHeight = gridHeight * cellSize;

  canvas.style.width = `${canvasCssWidth}px`;
  canvas.style.height = `${canvasCssHeight}px`;
  canvas.width = Math.floor(canvasCssWidth * canvasRatio);
  canvas.height = Math.floor(canvasCssHeight * canvasRatio);
  ctx.setTransform(canvasRatio, 0, 0, canvasRatio, 0, 0);
  updateCameraStatus();
}

function previewMatchesCurrentSelection(preview: BuildPreview): boolean {
  return (
    buildModeController.active &&
    previewMatchesSelection(
      preview,
      buildModeController.candidatePlacement,
      placementTransformState.operations,
    )
  );
}

function renderLocalBuildZoneOverlay(
  visibleBounds: VisibleGridBounds | null,
): void {
  if (!visibleBounds || localBuildZoneCells.length === 0) {
    return;
  }

  const visibleCells: Cell[] = [];
  for (let y = visibleBounds.minY; y <= visibleBounds.maxY; y += 1) {
    for (let x = visibleBounds.minX; x <= visibleBounds.maxX; x += 1) {
      if (localBuildZoneCellKeys.has(cellKey(x, y))) {
        visibleCells.push({ x, y });
      }
    }
  }

  if (visibleCells.length === 0) {
    return;
  }

  const hasBuildZoneCell = (x: number, y: number): boolean => {
    if (x < 0 || x >= gridWidth || y < 0 || y >= gridHeight) {
      return false;
    }
    return localBuildZoneCellKeys.has(cellKey(x, y));
  };

  ctx.fillStyle = 'rgba(94, 201, 255, 0.23)';

  const fillInset = 0.6;
  const fillSize = Math.max(1, cellSize - fillInset * 2);
  for (const cell of visibleCells) {
    ctx.fillRect(
      cell.x * cellSize + fillInset,
      cell.y * cellSize + fillInset,
      fillSize,
      fillSize,
    );
  }

  ctx.strokeStyle = 'rgba(94, 201, 255, 0.86)';
  ctx.lineWidth = 1 / cameraState.zoom;
  ctx.beginPath();

  for (const cell of visibleCells) {
    const left = cell.x * cellSize;
    const top = cell.y * cellSize;
    const right = left + cellSize;
    const bottom = top + cellSize;

    if (!hasBuildZoneCell(cell.x, cell.y - 1)) {
      ctx.moveTo(left, top);
      ctx.lineTo(right, top);
    }
    if (!hasBuildZoneCell(cell.x + 1, cell.y)) {
      ctx.moveTo(right, top);
      ctx.lineTo(right, bottom);
    }
    if (!hasBuildZoneCell(cell.x, cell.y + 1)) {
      ctx.moveTo(left, bottom);
      ctx.lineTo(right, bottom);
    }
    if (!hasBuildZoneCell(cell.x - 1, cell.y)) {
      ctx.moveTo(left, top);
      ctx.lineTo(left, bottom);
    }
  }

  ctx.stroke();
}

function renderBuildPreviewOverlay(
  visibleBounds: VisibleGridBounds | null,
): void {
  if (!visibleBounds || !latestBuildPreview) {
    return;
  }
  if (!previewMatchesCurrentSelection(latestBuildPreview)) {
    return;
  }

  const illegalCellKeys = new Set(
    latestBuildPreview.illegalCells.map(({ x, y }) => `${x},${y}`),
  );

  for (const cell of latestBuildPreview.illegalCells) {
    if (
      cell.x < visibleBounds.minX ||
      cell.x > visibleBounds.maxX ||
      cell.y < visibleBounds.minY ||
      cell.y > visibleBounds.maxY
    ) {
      continue;
    }

    ctx.fillStyle = 'rgba(224, 122, 122, 0.36)';
    ctx.fillRect(
      cell.x * cellSize + 1,
      cell.y * cellSize + 1,
      Math.max(1, cellSize - 2),
      Math.max(1, cellSize - 2),
    );
  }

  for (const cell of latestBuildPreview.footprint) {
    if (
      cell.x < visibleBounds.minX ||
      cell.x > visibleBounds.maxX ||
      cell.y < visibleBounds.minY ||
      cell.y > visibleBounds.maxY
    ) {
      continue;
    }

    const isIllegal = illegalCellKeys.has(`${cell.x},${cell.y}`);
    ctx.fillStyle = isIllegal
      ? 'rgba(224, 122, 122, 0.72)'
      : 'rgba(70, 213, 182, 0.52)';
    ctx.fillRect(
      cell.x * cellSize + 1,
      cell.y * cellSize + 1,
      Math.max(1, cellSize - 2),
      Math.max(1, cellSize - 2),
    );
  }

  ctx.strokeStyle = 'rgba(248, 192, 108, 0.85)';
  ctx.lineWidth = 1 / cameraState.zoom;
  for (const segment of getWrappedBoundsSegments(
    latestBuildPreview.bounds,
    gridWidth,
    gridHeight,
  )) {
    const segmentMaxX = segment.x + segment.width - 1;
    const segmentMaxY = segment.y + segment.height - 1;
    if (
      segmentMaxX < visibleBounds.minX ||
      segment.x > visibleBounds.maxX ||
      segmentMaxY < visibleBounds.minY ||
      segment.y > visibleBounds.maxY
    ) {
      continue;
    }

    ctx.strokeRect(
      segment.x * cellSize + 0.5,
      segment.y * cellSize + 0.5,
      segment.width * cellSize,
      segment.height * cellSize,
    );
  }
}

const renderScheduler = createRenderScheduler({
  render,
  requestAnimationFrame: (callback) => window.requestAnimationFrame(callback),
  cancelAnimationFrame: (frameId) => window.cancelAnimationFrame(frameId),
});

function requestRender(): void {
  renderScheduler.requestRender();
}

function render(): void {
  if (!gridBytes) return;

  const visibleBounds = computeVisibleGridBounds({
    camera: cameraState,
    canvasWidth: canvasCssWidth,
    canvasHeight: canvasCssHeight,
    cellSize,
    gridWidth,
    gridHeight,
  });

  ctx.setTransform(canvasRatio, 0, 0, canvasRatio, 0, 0);
  ctx.clearRect(0, 0, canvasCssWidth, canvasCssHeight);
  ctx.fillStyle = '#05070d';
  ctx.fillRect(0, 0, canvasCssWidth, canvasCssHeight);

  ctx.save();
  ctx.translate(cameraState.offsetX, cameraState.offsetY);
  ctx.scale(cameraState.zoom, cameraState.zoom);

  ctx.fillStyle = '#0b101b';
  ctx.fillRect(0, 0, gridWidth * cellSize, gridHeight * cellSize);

  renderLocalBuildZoneOverlay(visibleBounds);

  if (visibleBounds) {
    ctx.fillStyle = '#46d5b6';
    for (let y = visibleBounds.minY; y <= visibleBounds.maxY; y += 1) {
      const rowOffset = y * gridWidth;
      for (let x = visibleBounds.minX; x <= visibleBounds.maxX; x += 1) {
        const idx = rowOffset + x;
        if (gridBytes[idx] !== 1) continue;
        ctx.fillRect(x * cellSize, y * cellSize, cellSize, cellSize);
      }
    }
  }

  renderBuildPreviewOverlay(visibleBounds);
  ctx.restore();
}

function pointerToCell(event: PointerEvent): Cell | null {
  return screenPointToCell(cameraState, getCanvasViewportPoint(event), {
    cellSize,
    grid: {
      width: gridWidth,
      height: gridHeight,
    },
  });
}

function queueBuildAtCell(cell: Cell): void {
  if (!buildModeController.active) {
    setMessage('Select a template button to enter build mode.', true);
    return;
  }

  if (!canMutateGameplay()) {
    setMessage(
      'Build placement is read-only until you are an active, non-defeated player.',
      true,
    );
    return;
  }

  if (!currentRoomId || currentRoomId === '-') {
    setMessage('Join a room before queueing builds.', true);
    return;
  }

  setBuildCandidateFromCell(cell);
  const queueRequest = buildPreviewRequestFromSelection(
    buildModeController.candidatePlacement,
    toPlacementTransformInput(placementTransformState),
  );
  if (
    !queueRequest ||
    !latestBuildPreview ||
    !previewMatchesSelection(
      latestBuildPreview,
      buildModeController.candidatePlacement,
      placementTransformState.operations,
    ) ||
    !latestBuildPreview.affordable
  ) {
    refreshActionUi();
    return;
  }

  resetQueueFeedbackOverride();
  setQueueFeedbackOverride('Submitting build queue request...', false);
  overlayBuildFeedbackPending = true;
  overlayBuildFeedbackIsError = false;
  overlayBuildFeedbackCopy = 'Submitting build queue request...';
  socket.emit('build:queue', {
    templateId: queueRequest.templateId,
    x: queueRequest.x,
    y: queueRequest.y,
    transform: queueRequest.transform,
    delayTicks: readDelayTicks(),
  });
  refreshActionUi();
}

function updateTeamStats(payload: RoomStatePayload, refreshUi = true): void {
  syncCurrentTeamIdFromState(payload);

  roomEl.textContent = `${payload.roomName} (#${payload.roomId})`;
  roomCodeEl.textContent = currentRoomCode;

  if (currentTeamId === null) {
    latestLocalBaseTopLeft = null;
    latestTacticalTeamSnapshot = null;
    currentTeamDefeated = false;
    teamEl.textContent = 'Spectator';
    baseEl.textContent = 'Unknown';
    syncEconomyHud(null, payload.tick);
    if (refreshUi) {
      refreshActionUi();
    }
    return;
  }

  const team = payload.teams.find(({ id }) => id === currentTeamId);
  if (!team) {
    latestLocalBaseTopLeft = null;
    latestTacticalTeamSnapshot = null;
    currentTeamDefeated = false;
    teamEl.textContent = '#?';
    baseEl.textContent = 'Unknown';
    syncEconomyHud(null, payload.tick);
    if (refreshUi) {
      refreshActionUi();
    }
    return;
  }

  currentTeamDefeated = team.defeated;
  latestTacticalTeamSnapshot = team;
  latestLocalBaseTopLeft = {
    x: team.baseTopLeft.x,
    y: team.baseTopLeft.y,
  };
  if (currentTeamDefeated && !persistentDefeatReason) {
    persistentDefeatReason =
      'Your team was defeated. You are now spectating in read-only mode.';
  }

  teamEl.textContent = `#${team.id}`;
  if (team.defeated) {
    baseEl.textContent = 'Breached';
  } else if (team.baseIntact) {
    baseEl.textContent = 'Intact';
  } else {
    baseEl.textContent = 'Critical';
  }

  syncEconomyHud(team, payload.tick);
  if (refreshUi) {
    refreshActionUi();
  }
}

function renderLobbyMembership(payload: RoomMembershipPayload): void {
  currentMembership = payload;
  currentRoomCode = payload.roomCode;
  roomCodeEl.textContent = payload.roomCode;
  applyRoomStatus(payload.status);
  countdownSecondsRemaining = payload.countdownSecondsRemaining;
  renderLobbyUi();
  updateLifecycleUi();
}

function renderSpawnMarkers(payload: RoomStatePayload): void {
  lobbyScreenUi.renderSpawnMarkers(payload);
}

function getKeyboardPanDirection(key: string): CameraPanDirection | null {
  if (key === 'ArrowLeft' || key === 'a' || key === 'A') {
    return 'left';
  }
  if (key === 'ArrowRight' || key === 'd' || key === 'D') {
    return 'right';
  }
  if (key === 'ArrowUp' || key === 'w' || key === 'W') {
    return 'up';
  }
  if (key === 'ArrowDown' || key === 's' || key === 'S') {
    return 'down';
  }
  return null;
}

function applyKeyboardZoom(zoomFactor: number): void {
  if (!canUseCameraControls()) {
    return;
  }

  cameraState = applyWheelZoomAtPoint(
    cameraState,
    getCanvasViewportCenter(),
    zoomFactor,
  );
  updateCameraStatus();
  requestRender();
}

canvas.addEventListener('contextmenu', (event) => {
  if (!canUseCameraControls()) {
    return;
  }

  event.preventDefault();
});

canvas.addEventListener(
  'wheel',
  (event) => {
    if (!canUseCameraControls()) {
      return;
    }

    event.preventDefault();
    const zoomFactor = normalizeWheelZoomFactor(event.deltaY, event.deltaMode);
    cameraState = applyWheelZoomAtPoint(
      cameraState,
      getCanvasViewportPoint(event),
      zoomFactor,
    );
    updateCameraStatus();
    requestRender();
  },
  { passive: false },
);

canvas.addEventListener('pointerdown', (event) => {
  if (!gridBytes) {
    return;
  }

  if (event.button === 2) {
    if (!canUseCameraControls()) {
      return;
    }

    event.preventDefault();
    canvas.setPointerCapture(event.pointerId);
    isCameraPanning = true;
    cameraPanPointerId = event.pointerId;
    lastCameraPanClientPoint = {
      x: event.clientX,
      y: event.clientY,
    };
    updateCameraStatus();
    return;
  }

  if (event.button !== 0) {
    return;
  }

  const cell = pointerToCell(event);
  if (!cell) {
    return;
  }

  buildModeController.recordHover(cell);

  if (buildModeController.active) {
    queueBuildAtCell(cell);
    return;
  }

  if (selectDestroyStructureAtCell(cell)) {
    return;
  }

  if (structureInteractionState.pinnedKey) {
    applyStructureInteraction({ type: 'clear' });
    resetDestroyFeedbackOverride();
  }

  if (!canMutateGameplay()) {
    setMessage(
      'Build placement is read-only until you are an active, non-defeated player.',
      true,
    );
    return;
  }

  setMessage('Click a template button to enter build mode.');
});

canvas.addEventListener('pointermove', (event) => {
  if (isCameraPanning && cameraPanPointerId === event.pointerId) {
    if (!lastCameraPanClientPoint) {
      lastCameraPanClientPoint = {
        x: event.clientX,
        y: event.clientY,
      };
      return;
    }

    const deltaX = event.clientX - lastCameraPanClientPoint.x;
    const deltaY = event.clientY - lastCameraPanClientPoint.y;
    lastCameraPanClientPoint = {
      x: event.clientX,
      y: event.clientY,
    };
    cameraState = applyPanDelta(cameraState, deltaX, deltaY);
    updateCameraStatus();
    requestRender();
    return;
  }

  const cell = pointerToCell(event);
  if (cell) {
    buildModeController.recordHover(cell);
  }

  if (buildModeController.active && cell) {
    setBuildCandidateFromCell(cell);
    return;
  }

  updateStructureHoverStateForPointer(event);
});

function stopPointerInteraction(event: PointerEvent): void {
  if (isCameraPanning && cameraPanPointerId === event.pointerId) {
    isCameraPanning = false;
    cameraPanPointerId = null;
    lastCameraPanClientPoint = null;
    if (canvas.hasPointerCapture(event.pointerId)) {
      canvas.releasePointerCapture(event.pointerId);
    }
    updateCameraStatus();
    if (event.type === 'pointerleave' || event.type === 'pointercancel') {
      applyStructureInteraction({
        type: 'hover-leave',
        atMs: Date.now(),
        graceMs: DEFAULT_HOVER_LEAVE_GRACE_MS,
      });
    }
    return;
  }

  if (event.type === 'pointerleave' || event.type === 'pointercancel') {
    applyStructureInteraction({
      type: 'hover-leave',
      atMs: Date.now(),
      graceMs: DEFAULT_HOVER_LEAVE_GRACE_MS,
    });
  }
}

canvas.addEventListener('pointerup', stopPointerInteraction);
canvas.addEventListener('pointerleave', stopPointerInteraction);
canvas.addEventListener('pointercancel', stopPointerInteraction);

window.addEventListener('keydown', (event) => {
  if (!canUseCameraControls() || isFormElementFocused(event.target)) {
    return;
  }
  if (event.metaKey || event.ctrlKey || event.altKey) {
    return;
  }

  if (buildModeController.active) {
    if (event.key === 'Escape') {
      event.preventDefault();
      exitBuildMode();
      return;
    }

    if (event.key === 'r' || event.key === 'R') {
      event.preventDefault();
      applyTransformControl('rotate', 'Rotate 90deg');
      return;
    }

    if (event.key === 'h' || event.key === 'H') {
      event.preventDefault();
      applyTransformControl('mirror-horizontal', 'Horizontal mirror');
      return;
    }

    if (event.key === 'v' || event.key === 'V') {
      event.preventDefault();
      applyTransformControl('mirror-vertical', 'Vertical mirror');
      return;
    }
  }

  if (event.key === 'f' || event.key === 'F') {
    event.preventDefault();
    resetCameraForCurrentTeam();
    requestRender();
    return;
  }

  if (
    event.key === '+' ||
    (event.key === '=' && event.shiftKey) ||
    event.code === 'NumpadAdd'
  ) {
    event.preventDefault();
    applyKeyboardZoom(CAMERA_KEYBOARD_ZOOM_FACTOR);
    return;
  }

  if (
    event.key === '-' ||
    event.key === '_' ||
    event.code === 'NumpadSubtract'
  ) {
    event.preventDefault();
    applyKeyboardZoom(1 / CAMERA_KEYBOARD_ZOOM_FACTOR);
    return;
  }

  const panDirection = getKeyboardPanDirection(event.key);
  if (!panDirection) {
    return;
  }

  event.preventDefault();
  const panStep =
    CAMERA_KEYBOARD_WORLD_STEP_CELLS * cellSize * cameraState.zoom;
  cameraState = applyKeyboardPan(cameraState, panDirection, panStep);
  updateCameraStatus();
  requestRender();
});

window.addEventListener('resize', () => {
  const previousCellSize = cellSize;
  resizeCanvas();
  if (cellSize !== previousCellSize) {
    resetCameraForCurrentTeam();
  }
  if (gridBytes) {
    requestRender();
  }
});

socket.on('connect', () => {
  statusEl.textContent = 'Connected';
  clearConnectionIssue(true);
  scheduleBootstrapMembershipTimeout();
  socket.emit('room:list');
});

socket.on('disconnect', (reason) => {
  clearBootstrapMembershipTimeout();
  if (reason !== 'io client disconnect') {
    matchScreenState = markReconnectPending(matchScreenState);
    updateReconnectIndicator();
  }
  updateConnectionIssue(
    'Disconnected',
    'connection lost',
    `Connection lost (${reason}). Attempting to reconnect...`,
    reason !== 'io client disconnect',
  );
});

socket.on('connect_error', (error: Error) => {
  clearBootstrapMembershipTimeout();
  const detail =
    typeof error.message === 'string' && error.message.trim()
      ? error.message.trim()
      : 'network unavailable';
  updateConnectionIssue(
    'Connection Error',
    'unable to establish socket connection',
    `Unable to connect to server (${detail}). Waiting for automatic retry.`,
    true,
  );
});

socket.io.on('reconnect_attempt', (attempt) => {
  statusEl.textContent = `Reconnecting (${attempt})`;
  lifecycleConnectionNotice = `reconnecting (attempt ${attempt})`;
  setMessage(`Reconnecting to server (attempt ${attempt})...`, true);
  updateLifecycleStatusLine();
});

socket.io.on('reconnect_error', (error: Error) => {
  const detail =
    typeof error.message === 'string' && error.message.trim()
      ? error.message.trim()
      : 'unknown reconnect error';
  updateConnectionIssue(
    'Reconnect Error',
    'reconnect attempt failed',
    `Reconnect attempt failed (${detail}). Retrying automatically.`,
    false,
  );
});

socket.io.on('reconnect_failed', () => {
  clearBootstrapMembershipTimeout();
  updateConnectionIssue(
    'Reconnect Failed',
    'automatic reconnect exhausted',
    'Unable to reconnect automatically. Verify the server is running, then refresh this page.',
    true,
  );
});

socket.on('room:list', (rooms: RoomListEntryPayload[]) => {
  renderRoomList(rooms);
});

socket.on('room:joined', (payload: RoomJoinedPayload) => {
  clearBootstrapMembershipTimeout();
  clearConnectionIssue(true);

  currentRoomId = payload.roomId;
  currentRoomCode = payload.roomCode;
  currentRoomName = payload.roomName;
  currentTeamId = payload.teamId;
  clearPendingStateRequests();
  stateHashResyncState = applyJoinedHashes(
    stateHashResyncState,
    payload.stateHashes,
  );
  resetRoomTransitionFlags();
  resetRoomTransitionViewModels();
  availableTemplates = payload.templates;
  syncPreviewTemplateSnapshots(payload.templates);
  selectedTemplateId = payload.templates[0]?.id ?? '';
  buildModeController.deactivate();
  clearSelectedTemplatePlacement();
  buildModeController.recordHover(null);
  updateTemplateButtonMenu();
  applyAuthoritativePlayerIdentity({
    sessionId: payload.playerId,
    name: payload.playerName,
  });
  chatLogEl.innerHTML = '';
  renderFinishedResults();

  setMessage(
    payload.teamId === null
      ? `Joined ${payload.roomName} as spectator.`
      : `Joined ${payload.roomName} as team #${payload.teamId}.`,
  );

  applyStatePayload(payload.state);
  resizeCanvas();
  resetCameraForCurrentTeam();
  requestRender();
  updateVisibleMatchScreen();
  updateReconnectIndicator();
  updateLobbyControls();
  updateLifecycleUi();
});

socket.on('room:left', (payload: RoomLeftPayload) => {
  if (!shouldApplyCurrentRoomPayload(payload.roomId)) {
    return;
  }

  currentRoomId = '-';
  currentRoomCode = '-';
  currentRoomName = '-';
  currentTeamId = null;
  availableTemplates = [];
  previewTemplateSnapshotsById.clear();
  selectedTemplateId = '';
  buildModeController.deactivate();
  updateTemplateButtonMenu();
  clearSelectedTemplatePlacement();
  buildModeController.recordHover(null);
  gridWidth = 0;
  gridHeight = 0;
  gridBytes = null;
  gridPackedBytes = null;
  authoritativeGrid = null;
  latestTacticalTeamSnapshot = null;
  currentTeamDefeated = false;
  clearPendingStateRequests();
  stateHashResyncState = resetStateHashResyncState();
  resetRoomTransitionFlags();
  clearEdgeBannerTimeout();
  edgeBannerEl.classList.add('is-hidden');
  matchScreenState = createMatchScreenViewState('lobby');
  updateReconnectIndicator();
  resetRoomTransitionViewModels();
  cameraState = createCameraViewState();
  updateCameraStatus();
  applyRoomStatus('lobby');
  renderFinishedResults();

  roomEl.textContent = '-';
  roomCodeEl.textContent = '-';
  teamEl.textContent = '-';
  baseEl.textContent = 'Unknown';

  lobbyScreenUi.reset();
  chatLogEl.innerHTML = '';

  setMessage('You left the room.');
  updateLobbyControls();
  updateLifecycleUi();
  refreshActionUi();
});

socket.on('room:error', (payload: RoomErrorPayload) => {
  if (!shouldApplyCurrentRoomPayload(payload.roomId)) {
    return;
  }

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
    overlayBuildFeedbackPending = false;
    overlayBuildFeedbackCopy = deficitCopy;
    overlayBuildFeedbackIsError = true;
  } else if (
    payload.reason === 'outside-territory' ||
    payload.reason === 'template-exceeds-map-size' ||
    payload.reason === 'occupied-site' ||
    payload.reason === 'unknown-template' ||
    payload.reason === 'invalid-coordinates'
  ) {
    setQueueFeedbackOverride(
      `Cannot queue here: ${describeBuildFailureReason(payload.reason)}.`,
      true,
    );
    overlayBuildFeedbackPending = false;
    overlayBuildFeedbackCopy = `Cannot queue here: ${describeBuildFailureReason(payload.reason)}.`;
    overlayBuildFeedbackIsError = true;
  } else if (
    payload.reason === 'wrong-owner' ||
    payload.reason === 'invalid-target' ||
    payload.reason === 'invalid-lifecycle-state' ||
    payload.reason === 'invalid-delay'
  ) {
    setDestroyFeedbackOverride(
      `Destroy rejected: ${describeDestroyFailureReason(payload.reason)}.`,
      true,
    );
    overlayTeamFeedbackPending = false;
    overlayTeamFeedbackCopy = `Destroy rejected: ${describeDestroyFailureReason(payload.reason)}.`;
    overlayTeamFeedbackIsError = true;
  }

  if (payload.reason === 'defeated') {
    persistentDefeatReason =
      payload.message ||
      'Your team is defeated. You are now spectating in read-only mode.';
    currentTeamDefeated = true;
    updateLifecycleUi();
  }

  const suppressToast = shouldDeduplicateBuildErrorToast(payload, message);

  setMessage(message, true);
  if (!suppressToast) {
    addToast(message, true);
  }
  refreshActionUi();
});

socket.on('room:membership', (payload: RoomMembershipPayload) => {
  if (!shouldApplyCurrentRoomPayload(payload.roomId)) {
    return;
  }

  clearBootstrapMembershipTimeout();
  clearConnectionIssue(true);
  currentMembership = payload;
  stateHashResyncState = noteAppliedMembershipHash(
    stateHashResyncState,
    payload.membershipHash,
  );
  renderLobbyMembership(payload);
});

socket.on('room:countdown', (payload: RoomCountdownPayload) => {
  if (payload.roomId !== currentRoomId) {
    return;
  }

  countdownSecondsRemaining = payload.secondsRemaining;
  applyRoomStatus('countdown');
  if (currentMembership) {
    currentMembership = {
      ...currentMembership,
      status: 'countdown',
      countdownSecondsRemaining: payload.secondsRemaining,
    };
    renderLobbyUi();
  }
  updateLifecycleUi();
});

socket.on('room:match-started', (payload: MatchStartedPayload) => {
  if (!shouldApplyCurrentRoomPayload(payload.roomId)) {
    return;
  }

  countdownSecondsRemaining = null;
  applyRoomStatus('active');
  if (currentMembership) {
    currentMembership = {
      ...currentMembership,
      status: 'active',
      countdownSecondsRemaining: null,
    };
    renderLobbyUi();
  }
  addToast('Match started. Good luck.');
  requestStateSnapshot(true);
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
  if (currentMembership) {
    currentMembership = {
      ...currentMembership,
      status: 'finished',
      countdownSecondsRemaining: null,
    };
    renderLobbyUi();
  }
  renderFinishedResults();
  updateLifecycleUi();
  requestStateSnapshot(true);
});

socket.on('lockstep:checkpoint', (payload: LockstepCheckpointPayload) => {
  if (payload.roomId !== currentRoomId) {
    return;
  }

  if (payload.tick % 50 === 0) {
    requestStateSections(['grid']);
  }
});

socket.on('lockstep:fallback', (payload: LockstepFallbackPayload) => {
  if (payload.roomId !== currentRoomId) {
    return;
  }

  requestStateSnapshot(true);
});

socket.on('room:slot-claimed', (payload: RoomSlotClaimedPayload) => {
  if (!shouldApplyCurrentRoomPayload(payload.roomId)) {
    return;
  }

  const label = getTeamLabel(payload.slotId);
  currentTeamId = payload.teamId;
  setMessage(`Slot claimed: ${label}.`);
  addToast(`Slot claimed successfully: ${label}.`);
});

socket.on('chat:message', (payload: ChatMessagePayload) => {
  if (!shouldApplyCurrentRoomPayload(payload.roomId)) {
    return;
  }

  appendChatMessage(payload);
});

socket.on('player:profile', (payload: PlayerProfilePayload) => {
  applyAuthoritativePlayerIdentity({
    sessionId: payload.playerId,
    name: payload.name,
  });
  updateLobbyControls();
  updateLifecycleUi();
});

socket.on('build:outcome', (payload: BuildOutcomePayload) => {
  if (payload.roomId !== currentRoomId) {
    return;
  }

  requestStateSections(['grid', 'structures']);

  if (currentTeamId === null || payload.teamId !== currentTeamId) {
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
    overlayBuildFeedbackPending = false;
    overlayBuildFeedbackCopy = rejectionCopy;
    overlayBuildFeedbackIsError = true;
    setMessage(rejectionCopy, true);
  } else {
    resetQueueFeedbackOverride();
    overlayBuildFeedbackPending = false;
    overlayBuildFeedbackCopy = `Build #${payload.eventId} applied.`;
    overlayBuildFeedbackIsError = false;
    setQueueFeedbackOverride(overlayBuildFeedbackCopy, false);
  }

  refreshActionUi();
});

socket.on('build:queued', (payload: BuildQueuedPayload) => {
  if (payload.roomId !== currentRoomId) {
    return;
  }

  if (currentTeamId === null || payload.teamId !== currentTeamId) {
    return;
  }

  overlayBuildFeedbackPending = true;
  overlayBuildFeedbackIsError = false;
  overlayBuildFeedbackCopy = `Build intent buffered for turn ${payload.scheduledByTurn}.`;
  setQueueFeedbackOverride(overlayBuildFeedbackCopy, false);
  setMessage(overlayBuildFeedbackCopy);
  refreshActionUi();
});

socket.on('build:queue-rejected', (payload: BuildQueueRejectedPayload) => {
  if (payload.roomId !== currentRoomId) {
    return;
  }

  if (currentTeamId === null || payload.teamId !== currentTeamId) {
    return;
  }

  const rejectionCopy =
    payload.reason === 'insufficient-resources' &&
    typeof payload.needed === 'number' &&
    typeof payload.current === 'number' &&
    typeof payload.deficit === 'number'
      ? formatDeficitCopy(payload.needed, payload.current, payload.deficit)
      : `Build intent rejected: ${describeBuildFailureReason(
          payload.reason as Parameters<typeof describeBuildFailureReason>[0],
        )}.`;

  setQueueFeedbackOverride(rejectionCopy, true);
  overlayBuildFeedbackPending = false;
  overlayBuildFeedbackCopy = rejectionCopy;
  overlayBuildFeedbackIsError = true;
  setMessage(rejectionCopy, true);
  addToast(rejectionCopy, true);
  refreshActionUi();
});

socket.on('build:scheduled', (payload: BuildScheduledPayload) => {
  if (payload.roomId !== currentRoomId) {
    return;
  }

  requestStateSections(['structures']);

  if (currentTeamId === null || payload.teamId !== currentTeamId) {
    return;
  }

  overlayBuildFeedbackPending = false;
  overlayBuildFeedbackIsError = false;
  overlayBuildFeedbackCopy = `Build scheduled (#${payload.eventId}) for tick ${payload.executeTick}.`;
  setQueueFeedbackOverride(overlayBuildFeedbackCopy, false);
  addToast(overlayBuildFeedbackCopy);
  setMessage(overlayBuildFeedbackCopy);
  refreshActionUi();
});

socket.on('destroy:outcome', (payload: DestroyOutcomePayload) => {
  if (payload.roomId !== currentRoomId) {
    return;
  }

  requestStateSections(['grid', 'structures']);

  if (currentTeamId === null || payload.teamId !== currentTeamId) {
    return;
  }

  destroyViewState = registerDestroyOutcome(destroyViewState, {
    structureKey: payload.structureKey,
    outcome: payload.outcome,
  });

  if (payload.outcome === 'rejected') {
    const rejectionCopy = `Destroy #${payload.eventId} rejected: ${describeDestroyFailureReason(payload.reason)}.`;
    setDestroyFeedbackOverride(rejectionCopy, true);
    overlayTeamFeedbackPending = false;
    overlayTeamFeedbackCopy = rejectionCopy;
    overlayTeamFeedbackIsError = true;
    setMessage(rejectionCopy, true);
    addToast(rejectionCopy, true);
  } else {
    const successCopy = `Destroy applied for ${payload.structureKey}.`;
    setDestroyFeedbackOverride(successCopy, false);
    overlayTeamFeedbackPending = false;
    overlayTeamFeedbackCopy = successCopy;
    overlayTeamFeedbackIsError = false;
    setMessage(successCopy);
    addToast('Structure destroyed.');
  }

  refreshActionUi();
});

socket.on('destroy:queued', (payload: DestroyQueuedPayload) => {
  if (payload.roomId !== currentRoomId) {
    return;
  }

  if (currentTeamId === null || payload.teamId !== currentTeamId) {
    return;
  }

  const feedback = `Destroy intent buffered for turn ${payload.scheduledByTurn}.`;

  overlayTeamFeedbackPending = true;
  overlayTeamFeedbackCopy = feedback;
  overlayTeamFeedbackIsError = false;
  setDestroyFeedbackOverride(feedback, false);
  setMessage(feedback);
  refreshActionUi();
});

socket.on('destroy:queue-rejected', (payload: DestroyQueueRejectedPayload) => {
  if (payload.roomId !== currentRoomId) {
    return;
  }

  if (currentTeamId === null || payload.teamId !== currentTeamId) {
    return;
  }

  const rejectionCopy = `Destroy intent rejected: ${describeDestroyFailureReason(payload.reason)}.`;

  setDestroyFeedbackOverride(rejectionCopy, true);
  overlayTeamFeedbackPending = false;
  overlayTeamFeedbackCopy = rejectionCopy;
  overlayTeamFeedbackIsError = true;
  setMessage(rejectionCopy, true);
  addToast(rejectionCopy, true);
  refreshActionUi();
});

socket.on('destroy:scheduled', (payload: DestroyScheduledPayload) => {
  if (payload.roomId !== currentRoomId) {
    return;
  }

  requestStateSections(['structures']);

  if (currentTeamId === null || payload.teamId !== currentTeamId) {
    return;
  }

  destroyViewState = registerDestroyQueued(
    destroyViewState,
    payload.structureKey,
  );

  const feedback = payload.idempotent
    ? `Destroy already pending for ${payload.structureKey}.`
    : `Destroy scheduled (#${payload.eventId}) for tick ${payload.executeTick}.`;

  overlayTeamFeedbackPending = false;
  overlayTeamFeedbackCopy = feedback;
  overlayTeamFeedbackIsError = false;
  setDestroyFeedbackOverride(feedback, false);
  setMessage(feedback);
  if (!payload.idempotent) {
    addToast(feedback);
  }
  refreshActionUi();
});

socket.on('state:grid', (payload: RoomGridStatePayload) => {
  if (payload.roomId !== currentRoomId) {
    return;
  }

  stateHashResyncState = noteAppliedGridHash(
    stateHashResyncState,
    payload.hashHex,
  );
  applyGridStatePayload(payload);
});

socket.on('state:structures', (payload: RoomStructuresStatePayload) => {
  if (payload.roomId !== currentRoomId) {
    return;
  }

  stateHashResyncState = noteAppliedStructuresHash(
    stateHashResyncState,
    payload.hashHex,
  );
  applyStructuresStatePayload(payload);
});

socket.on('state:hashes', (payload: RoomStateHashesPayload) => {
  if (payload.roomId !== currentRoomId) {
    return;
  }

  const nextResyncState = reconcileIncomingHashes(
    stateHashResyncState,
    payload,
  );
  stateHashResyncState = nextResyncState.state;

  if (nextResyncState.requestSections.length > 0) {
    requestStateSections(nextResyncState.requestSections);
  }
});

socket.on('state', (payload: RoomStatePayload) => {
  if (!shouldApplyCurrentRoomPayload(payload.roomId)) {
    return;
  }

  stateHashResyncState = markAwaitingHashesAfterFullState(stateHashResyncState);
  applyStatePayload(payload);
});

setNameButton.addEventListener('click', () => {
  const name = resolveJoinDisplayName();
  socket.emit('player:set-name', {
    name,
  });
});

buildDelayEl.addEventListener('change', () => {
  readDelayTicks();
});

transformRotateButton.addEventListener('click', () => {
  applyTransformControl('rotate', 'Rotate 90deg');
});

transformMirrorHorizontalButton.addEventListener('click', () => {
  applyTransformControl('mirror-horizontal', 'Horizontal mirror');
});

transformMirrorVerticalButton.addEventListener('click', () => {
  applyTransformControl('mirror-vertical', 'Vertical mirror');
});

exitBuildModeButton.addEventListener('click', () => {
  exitBuildMode();
});

createRoomButton.addEventListener('click', () => {
  const size = Number(newRoomSizeEl.value);
  syncPlayerNameBeforeJoin();
  socket.emit('room:create', {
    name: newRoomNameEl.value,
    width: size,
    height: size,
    slots: DEFAULT_WEB_ROOM_SLOT_DEFINITIONS.map((slot) => ({ ...slot })),
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
lobbyScreenUi.setClaimHandler((slotId) => {
  socket.emit('room:claim-slot', { slotId });
});

toggleReadyButton.addEventListener('click', () => {
  if (!currentMembership) {
    return;
  }

  const self = getSelfParticipant();
  if (!self) {
    return;
  }

  socket.emit('room:set-ready', { ready: !self.ready });
});

startMatchButton.addEventListener('click', () => {
  socket.emit('room:start');
});

destroyQueueButton.addEventListener('click', () => {
  emitDestroyQueueForSelection();
});

destroyConfirmButton.addEventListener('click', () => {
  if (!destroyViewState.confirmArmed) {
    destroyViewState = armDestroyConfirm(destroyViewState);
    refreshActionUi();
    return;
  }

  emitDestroyQueueForSelection();
});

destroyCancelButton.addEventListener('click', () => {
  destroyViewState = cancelDestroyConfirm(destroyViewState);
  resetDestroyFeedbackOverride();
  refreshActionUi();
});

finishedMinimizeButton.addEventListener('click', () => {
  isFinishedPanelMinimized = !isFinishedPanelMinimized;
  updateFinishedPanelState();
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

overlayTabEconomyButton.addEventListener('click', () => {
  setActiveOverlayTab('economy');
});

overlayTabBuildButton.addEventListener('click', () => {
  setActiveOverlayTab('build');
});

overlayTabTeamButton.addEventListener('click', () => {
  setActiveOverlayTab('team');
});

updateTransformIndicator();
updateTemplateButtonMenu();
resetEconomyTracking();
resetDestroyInteractionState();
setActiveOverlayTab(activeOverlayTab);
resetTacticalOverlayState();
updateVisibleMatchScreen();
updateReconnectIndicator();
updateLobbyControls();
renderFinishedResults();
updateLifecycleUi();
refreshActionUi();
