import type { MatchOutcome } from '#rts-engine';
import { RtsRoom } from '#rts-engine';

import type { ActionSpaceInfo } from './action-decoder.js';
import { ActionDecoder } from './action-decoder.js';
import type { BotStrategy } from './bot-strategy.js';
import { applyBotActions, createBotView } from './match-runner.js';
import type { ObservationResult } from './observation-encoder.js';
import { ObservationEncoder } from './observation-encoder.js';
import { RandomBot } from './random-bot.js';
import type { RewardConfig, RewardStateSnapshot } from './reward-signal.js';
import { DEFAULT_REWARD_CONFIG, computeReward } from './reward-signal.js';
import { seedToRoomId } from './seed.js';
import { DEFAULT_GRID_HEIGHT, DEFAULT_GRID_WIDTH, DEFAULT_MAX_TICKS } from './types.js';

/**
 * Per-step auxiliary info returned alongside the observation and reward.
 */
export interface StepInfo {
  tick: number;
  actionMask: Uint8Array;
  actionSpaceSize: number;
  teamId: number;
  matchOutcome: MatchOutcome | null;
}

/**
 * Gymnasium-style 5-tuple returned from step().
 */
export interface StepResult {
  observation: ObservationResult;
  reward: number;
  terminated: boolean;
  truncated: boolean;
  info: StepInfo;
}

/**
 * Result from reset(): initial observation and info (no reward/terminated/truncated).
 */
export interface ResetResult {
  observation: ObservationResult;
  info: StepInfo;
}

/**
 * Configuration for the BotEnvironment.
 * All fields are optional with sensible defaults.
 */
export interface BotEnvironmentConfig {
  gridWidth?: number;
  gridHeight?: number;
  maxTicks?: number;
  rewardConfig?: RewardConfig;
}

/**
 * Gymnasium-style environment wrapping an RtsRoom for RL training.
 *
 * Single-agent per instance: one team is the RL agent, the other is
 * driven by a BotStrategy opponent. The environment hides all RtsRoom
 * complexity behind reset()/step().
 */
export class BotEnvironment {
  readonly observationSpace: {
    planes: { shape: [number, number, number]; dtype: 'float32' };
    scalars: { shape: [number]; dtype: 'float32' };
  };
  readonly actionSpace: ActionSpaceInfo;

  private readonly gridWidth: number;
  private readonly gridHeight: number;
  private readonly maxTicks: number;
  private readonly rewardConfig: RewardConfig;
  private readonly encoder: ObservationEncoder;
  private readonly actionDecoder: ActionDecoder;

  private room!: RtsRoom;
  private opponent!: BotStrategy;
  private agentTeamId!: number;
  private agentPlayerId!: string;
  private opponentTeamId!: number;
  private opponentPlayerId!: string;
  private tick!: number;
  private prevSnapshot!: RewardStateSnapshot;
  private episodeCount: number = 0;

  constructor(config?: BotEnvironmentConfig) {
    this.gridWidth = config?.gridWidth ?? DEFAULT_GRID_WIDTH;
    this.gridHeight = config?.gridHeight ?? DEFAULT_GRID_HEIGHT;
    this.maxTicks = config?.maxTicks ?? DEFAULT_MAX_TICKS;
    this.rewardConfig = config?.rewardConfig ?? DEFAULT_REWARD_CONFIG;

    this.encoder = new ObservationEncoder(this.gridWidth, this.gridHeight);
    this.actionDecoder = new ActionDecoder(this.gridWidth, this.gridHeight);

    this.observationSpace = {
      planes: { shape: [5, this.gridHeight, this.gridWidth], dtype: 'float32' },
      scalars: { shape: [7], dtype: 'float32' },
    };

    // Static action space descriptor based on grid dimensions.
    // Actual template count matches after reset but the 5 default
    // templates are the canonical set for the default engine config.
    const numPositions = this.gridWidth * this.gridHeight;
    const numTemplates = 5;
    this.actionSpace = {
      type: 'Discrete',
      n: numTemplates * numPositions + 1,
      numTemplates,
      numPositions,
      templateIds: ['block', 'eater-1', 'generator', 'glider', 'gosper'],
    };
  }

  /**
   * Set the episode number externally so the training loop can control
   * reward annealing independently of how many times reset() is called.
   */
  public setEpisodeNumber(n: number): void {
    this.episodeCount = n;
  }

  /**
   * Reset the environment to a fresh match.
   *
   * @param seed - Deterministic seed for room creation
   * @param opponent - BotStrategy for the opposing team (defaults to RandomBot)
   * @returns Initial observation and info
   */
  public reset(seed: number, opponent?: BotStrategy): ResetResult {
    this.episodeCount++;
    this.tick = 0;

    this.agentPlayerId = 'rl-agent';
    this.opponentPlayerId = 'opponent';

    const roomId = seedToRoomId(seed);
    this.room = RtsRoom.create({
      id: roomId,
      name: 'env-' + String(seed),
      width: this.gridWidth,
      height: this.gridHeight,
    });

    const agentTeam = this.room.addPlayer(this.agentPlayerId, 'RL Agent');
    this.agentTeamId = agentTeam.id;

    const opponentTeam = this.room.addPlayer(this.opponentPlayerId, 'Opponent');
    this.opponentTeamId = opponentTeam.id;

    this.opponent = opponent ?? new RandomBot();

    // Capture initial reward snapshot
    this.prevSnapshot = this.captureRewardSnapshot();

    // Encode initial observation
    const observation = this.encoder.encode(
      this.room,
      this.agentTeamId,
      0,
      this.maxTicks,
    );

    // Compute initial action mask
    const actionMask = this.actionDecoder.computeActionMask(
      this.room,
      this.agentPlayerId,
      this.agentTeamId,
    );

    return {
      observation,
      info: {
        tick: 0,
        actionMask,
        actionSpaceSize: actionMask.length,
        teamId: this.agentTeamId,
        matchOutcome: null,
      },
    };
  }

  /**
   * Advance the environment by one tick.
   *
   * @param action - Discrete action index (0 = no-op, 1..N = build actions)
   * @returns Gymnasium-style 5-tuple
   */
  public step(action: number): StepResult {
    // 1. Decode and apply agent action
    const buildPayload = this.actionDecoder.decode(action);
    if (buildPayload !== null) {
      this.room.queueBuildEvent(this.agentPlayerId, buildPayload);
    }

    // 2. Get opponent view and apply opponent actions
    const opponentView = createBotView(
      this.room,
      this.opponentTeamId,
      this.tick,
    );
    const opponentActions = this.opponent.decideTick(
      opponentView,
      this.opponentTeamId,
    );
    applyBotActions(this.room, this.opponentPlayerId, opponentActions);

    // 3. Advance simulation
    const tickResult = this.room.tick();
    this.tick++;

    // 4. Determine termination state
    const terminated = tickResult.outcome !== null;
    const truncated = !terminated && this.tick >= this.maxTicks;

    // 5. Determine winner for reward computation
    let isWinner: boolean | null = null;
    if (terminated) {
      isWinner = tickResult.outcome!.winner.teamId === this.agentTeamId;
    }

    // 6. Compute reward
    const currentSnapshot = this.captureRewardSnapshot();
    const reward = computeReward(
      this.prevSnapshot,
      currentSnapshot,
      terminated,
      truncated,
      isWinner,
      this.rewardConfig,
      this.episodeCount,
    );
    this.prevSnapshot = currentSnapshot;

    // 7. Encode observation
    const observation = this.encoder.encode(
      this.room,
      this.agentTeamId,
      this.tick,
      this.maxTicks,
    );

    // 8. Compute action mask (empty if episode is over)
    const actionMask =
      terminated || truncated
        ? new Uint8Array(0)
        : this.actionDecoder.computeActionMask(
            this.room,
            this.agentPlayerId,
            this.agentTeamId,
          );

    return {
      observation,
      reward,
      terminated,
      truncated,
      info: {
        tick: this.tick,
        actionMask,
        actionSpaceSize: actionMask.length,
        teamId: this.agentTeamId,
        matchOutcome: tickResult.outcome,
      },
    };
  }

  /**
   * Captures the current reward-relevant state for the agent's team.
   */
  private captureRewardSnapshot(): RewardStateSnapshot {
    const payload = this.room.createStatePayload();
    const ownTeam = payload.teams.find((t) => t.id === this.agentTeamId)!;
    const enemyTeam = payload.teams.find((t) => t.id !== this.agentTeamId)!;

    const ownCore = ownTeam.structures.find((s) => s.isCore);
    const enemyCore = enemyTeam.structures.find((s) => s.isCore);

    return {
      resources: ownTeam.resources,
      income: ownTeam.income,
      coreHp: ownCore?.hp ?? 0,
      enemyCoreHp: enemyCore?.hp ?? 0,
    };
  }
}
