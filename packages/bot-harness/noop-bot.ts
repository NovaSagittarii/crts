import type { BotAction, BotStrategy, BotView } from './bot-strategy.js';

export class NoOpBot implements BotStrategy {
  public readonly name = 'NoOpBot';

  public decideTick(_view: BotView, _teamId: number): BotAction[] {
    return [];
  }
}
