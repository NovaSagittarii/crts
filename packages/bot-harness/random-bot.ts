import type { BuildQueuePayload } from '#rts-engine';

import type { BotAction, BotStrategy, BotView } from './bot-strategy.js';

export class RandomBot implements BotStrategy {
  public readonly name = 'RandomBot';

  public decideTick(view: BotView, _teamId: number): BotAction[] {
    if (view.teamState.defeated) return [];

    const affordable = view.templates.filter(
      (t) => t.activationCost <= view.teamState.resources,
    );
    if (affordable.length === 0) return [];

    // Pick random affordable template
    const template = affordable[Math.floor(Math.random() * affordable.length)];

    // Collect candidate positions near existing structures
    const candidates: { x: number; y: number }[] = [];
    for (const structure of view.teamState.structures) {
      const radius = structure.buildRadius;
      for (let dx = -radius; dx <= radius; dx++) {
        for (let dy = -radius; dy <= radius; dy++) {
          const x = structure.x + dx;
          const y = structure.y + dy;
          if (
            x >= 0 &&
            y >= 0 &&
            x + template.width <= view.roomWidth &&
            y + template.height <= view.roomHeight
          ) {
            candidates.push({ x, y });
          }
        }
      }
    }

    if (candidates.length === 0) return [];

    // Pick random candidate
    const pos = candidates[Math.floor(Math.random() * candidates.length)];

    const build: BuildQueuePayload = {
      templateId: template.id,
      x: pos.x,
      y: pos.y,
    };

    return [{ type: 'build', build }];
  }
}
