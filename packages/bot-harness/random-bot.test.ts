import { describe, expect, it } from 'vitest';

import { Grid } from '#conway-core';
import { RtsRoom, type StructureTemplateSummary } from '#rts-engine';

import type { BotView, TeamStateView } from './bot-strategy.js';
import { NoOpBot } from './noop-bot.js';
import { RandomBot } from './random-bot.js';

function createMinimalTeamState(
  overrides: Partial<TeamStateView> = {},
): TeamStateView {
  return {
    id: 1,
    resources: 40,
    income: 1,
    incomeBreakdown: {
      base: 1,
      structures: 0,
      total: 1,
      activeStructureCount: 0,
    },
    structures: [],
    pendingBuilds: [],
    pendingDestroys: [],
    defeated: false,
    baseTopLeft: { x: 0, y: 0 },
    ...overrides,
  };
}

function createMinimalBotView(overrides: Partial<BotView> = {}): BotView {
  return {
    tick: 0,
    grid: new Grid(52, 52, [], 'flat'),
    teamState: createMinimalTeamState(),
    templates: [
      {
        id: 'block',
        name: 'Block 2x2',
        width: 2,
        height: 2,
        activationCost: 0,
        income: 0,
        startingHp: 20,
        buildRadius: 20,
      },
      {
        id: 'generator',
        name: 'Generator Block',
        width: 2,
        height: 2,
        activationCost: 10,
        income: 1,
        startingHp: 20,
        buildRadius: 0,
      },
    ],
    roomWidth: 52,
    roomHeight: 52,
    ...overrides,
  };
}

describe('NoOpBot', () => {
  const bot = new NoOpBot();

  it('has name "NoOpBot"', () => {
    expect(bot.name).toBe('NoOpBot');
  });

  it('always returns empty array regardless of view state', () => {
    const view = createMinimalBotView();
    expect(bot.decideTick(view, 1)).toEqual([]);
  });

  it('returns empty array even with rich game state', () => {
    const view = createMinimalBotView({
      tick: 500,
      teamState: createMinimalTeamState({
        resources: 1000,
        structures: [
          {
            key: 'core-1',
            templateId: 'core',
            templateName: 'Core',
            x: 5,
            y: 5,
            width: 5,
            height: 5,
            hp: 500,
            active: true,
            buildRadius: 14,
            isCore: true,
            requiresDestroyConfirm: true,
            transform: {
              operations: [],
              matrix: { xx: 1, xy: 0, yx: 0, yy: 1 },
            },
            footprint: [],
          },
        ],
      }),
    });
    expect(bot.decideTick(view, 1)).toEqual([]);
  });
});

describe('RandomBot', () => {
  const bot = new RandomBot();

  it('has name "RandomBot"', () => {
    expect(bot.name).toBe('RandomBot');
  });

  it('returns empty array when team is defeated', () => {
    const view = createMinimalBotView({
      teamState: createMinimalTeamState({ defeated: true }),
    });
    expect(bot.decideTick(view, 1)).toEqual([]);
  });

  it('returns empty array when no templates are affordable', () => {
    const view = createMinimalBotView({
      teamState: createMinimalTeamState({ resources: 0 }),
      templates: [
        {
          id: 'expensive',
          name: 'Expensive',
          width: 2,
          height: 2,
          activationCost: 100,
          income: 0,
          startingHp: 20,
          buildRadius: 10,
        },
      ],
    });
    expect(bot.decideTick(view, 1)).toEqual([]);
  });

  it('places a build action when resources are sufficient and structures exist', () => {
    const view = createMinimalBotView({
      teamState: createMinimalTeamState({
        resources: 40,
        structures: [
          {
            key: 'core-1',
            templateId: 'core',
            templateName: 'Core',
            x: 25,
            y: 25,
            width: 5,
            height: 5,
            hp: 500,
            active: true,
            buildRadius: 14,
            isCore: true,
            requiresDestroyConfirm: true,
            transform: {
              operations: [],
              matrix: { xx: 1, xy: 0, yx: 0, yy: 1 },
            },
            footprint: [],
          },
        ],
      }),
    });

    const actions = bot.decideTick(view, 1);
    expect(actions.length).toBe(1);
    expect(actions[0].type).toBe('build');
    expect(actions[0].build).toBeDefined();
    expect(actions[0].build!.templateId).toBeDefined();
    expect(typeof actions[0].build!.x).toBe('number');
    expect(typeof actions[0].build!.y).toBe('number');
  });

  it('only produces build type actions (never destroy)', () => {
    const view = createMinimalBotView({
      teamState: createMinimalTeamState({
        resources: 100,
        structures: [
          {
            key: 'core-1',
            templateId: 'core',
            templateName: 'Core',
            x: 25,
            y: 25,
            width: 5,
            height: 5,
            hp: 500,
            active: true,
            buildRadius: 14,
            isCore: true,
            requiresDestroyConfirm: true,
            transform: {
              operations: [],
              matrix: { xx: 1, xy: 0, yx: 0, yy: 1 },
            },
            footprint: [],
          },
        ],
      }),
    });

    // Run multiple times to check for randomness
    for (let i = 0; i < 20; i++) {
      const actions = bot.decideTick(view, 1);
      for (const action of actions) {
        expect(action.type).toBe('build');
      }
    }
  });

  it('uses valid templateId from available templates', () => {
    const templates: StructureTemplateSummary[] = [
      {
        id: 'block',
        name: 'Block 2x2',
        width: 2,
        height: 2,
        activationCost: 0,
        income: 0,
        startingHp: 20,
        buildRadius: 20,
      },
    ];

    const view = createMinimalBotView({
      templates,
      teamState: createMinimalTeamState({
        resources: 40,
        structures: [
          {
            key: 'core-1',
            templateId: 'core',
            templateName: 'Core',
            x: 25,
            y: 25,
            width: 5,
            height: 5,
            hp: 500,
            active: true,
            buildRadius: 14,
            isCore: true,
            requiresDestroyConfirm: true,
            transform: {
              operations: [],
              matrix: { xx: 1, xy: 0, yx: 0, yy: 1 },
            },
            footprint: [],
          },
        ],
      }),
    });

    for (let i = 0; i < 20; i++) {
      const actions = bot.decideTick(view, 1);
      if (actions.length > 0) {
        const templateIds = templates.map((t) => t.id);
        expect(templateIds).toContain(actions[0].build!.templateId);
      }
    }
  });

  it('returns empty array when no structures exist to place near', () => {
    const view = createMinimalBotView({
      teamState: createMinimalTeamState({
        resources: 40,
        structures: [],
      }),
    });

    const actions = bot.decideTick(view, 1);
    expect(actions).toEqual([]);
  });

  describe('integration with RtsRoom', () => {
    it('placements are accepted by previewBuildPlacement in a real room', () => {
      const room = RtsRoom.create({
        id: 'test-room',
        name: 'Test Room',
        width: 52,
        height: 52,
      });

      const team = room.addPlayer('bot-player-1', 'Bot1');
      room.addPlayer('bot-player-2', 'Bot2');

      // Build a BotView from the real room state
      const payload = room.createStatePayload();
      const teamPayload = payload.teams.find((t) => t.id === team.id)!;
      const templates = room.state.templates.map((t) => t.toSummary());

      const botView: BotView = {
        tick: room.state.tick,
        grid: room.state.grid,
        teamState: {
          id: teamPayload.id,
          resources: teamPayload.resources,
          income: teamPayload.income,
          incomeBreakdown: teamPayload.incomeBreakdown,
          structures: teamPayload.structures,
          pendingBuilds: teamPayload.pendingBuilds,
          pendingDestroys: teamPayload.pendingDestroys,
          defeated: teamPayload.defeated,
          baseTopLeft: teamPayload.baseTopLeft,
        },
        templates,
        roomWidth: payload.width,
        roomHeight: payload.height,
      };

      // Attempt multiple times since RandomBot picks random positions.
      // Many positions will overlap with existing structures or fall outside
      // the euclidean build zone, so we need enough attempts.
      let accepted = false;
      for (let attempt = 0; attempt < 200; attempt++) {
        const actions = bot.decideTick(botView, team.id);
        if (actions.length === 0) continue;

        const action = actions[0];
        if (action.type === 'build' && action.build) {
          const preview = room.previewBuildPlacement(
            'bot-player-1',
            action.build,
          );
          if (preview.accepted) {
            accepted = true;
            break;
          }
        }
      }

      expect(accepted).toBe(true);
    });
  });
});
