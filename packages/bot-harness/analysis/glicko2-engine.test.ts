import { describe, it, expect } from 'vitest';

import { updateRating, GLICKO2_DEFAULTS } from './glicko2-engine.js';
import type { Glicko2Rating, MatchResult } from './types.js';

describe('glicko2-engine', () => {
  describe('GLICKO2_DEFAULTS', () => {
    it('exports default hyperparameters', () => {
      expect(GLICKO2_DEFAULTS.initialRating).toBe(1500);
      expect(GLICKO2_DEFAULTS.initialRd).toBe(350);
      expect(GLICKO2_DEFAULTS.initialVolatility).toBe(0.06);
      expect(GLICKO2_DEFAULTS.tau).toBe(0.5);
      expect(GLICKO2_DEFAULTS.scaleFactor).toBeCloseTo(173.7178, 3);
      expect(GLICKO2_DEFAULTS.convergenceTol).toBe(1e-6);
    });
  });

  describe('updateRating', () => {
    it('matches Glickman paper example (Section 4)', () => {
      // Player: rating 1500, RD 200, volatility 0.06
      // Matches: beats 1400/RD30, loses to 1550/RD100, loses to 1700/RD300
      const player: Glicko2Rating = {
        rating: 1500,
        rd: 200,
        volatility: 0.06,
      };

      const matches: MatchResult[] = [
        { opponentRating: 1400, opponentRd: 30, score: 1.0 },
        { opponentRating: 1550, opponentRd: 100, score: 0.0 },
        { opponentRating: 1700, opponentRd: 300, score: 0.0 },
      ];

      const result = updateRating(player, matches);

      // Expected values from Glickman's paper example
      expect(result.rating).toBeCloseTo(1464.06, 0);
      expect(result.rd).toBeCloseTo(151.52, 0);
      expect(result.volatility).toBeCloseTo(0.05999, 4);
    });

    it('increases RD with no matches but keeps rating and volatility unchanged', () => {
      const player: Glicko2Rating = {
        rating: 1500,
        rd: 200,
        volatility: 0.06,
      };

      const result = updateRating(player, []);

      // Rating and volatility unchanged
      expect(result.rating).toBe(1500);
      expect(result.volatility).toBe(0.06);

      // RD increases: new_rd = sqrt(rd^2 + vol^2) on Glicko-2 scale, then back
      // phi = 200/173.7178, sigma = 0.06
      // phiStar = sqrt(phi^2 + sigma^2) => rd increases slightly
      expect(result.rd).toBeGreaterThan(200);
    });

    it('increases rating after winning against weaker opponent', () => {
      const player: Glicko2Rating = {
        rating: 1500,
        rd: 200,
        volatility: 0.06,
      };

      const matches: MatchResult[] = [
        { opponentRating: 1200, opponentRd: 100, score: 1.0 },
      ];

      const result = updateRating(player, matches);

      expect(result.rating).toBeGreaterThan(1500);
      expect(result.rd).toBeLessThan(200);
    });

    it('decreases rating significantly after losing to weaker opponent', () => {
      const player: Glicko2Rating = {
        rating: 1500,
        rd: 200,
        volatility: 0.06,
      };

      const matches: MatchResult[] = [
        { opponentRating: 1200, opponentRd: 100, score: 0.0 },
      ];

      const result = updateRating(player, matches);

      expect(result.rating).toBeLessThan(1500);
      // Losing to a weaker opponent is more informative, so RD decreases
      expect(result.rd).toBeLessThan(200);
    });

    it('converges Step 5 iteration within 100 iterations', () => {
      // Use extreme values that stress the convergence
      const player: Glicko2Rating = {
        rating: 1500,
        rd: 350,
        volatility: 0.06,
      };

      const matches: MatchResult[] = [
        { opponentRating: 1900, opponentRd: 50, score: 1.0 },
        { opponentRating: 1100, opponentRd: 50, score: 0.0 },
      ];

      // Should not throw (infinite loop) or return NaN
      const result = updateRating(player, matches);

      expect(Number.isFinite(result.rating)).toBe(true);
      expect(Number.isFinite(result.rd)).toBe(true);
      expect(Number.isFinite(result.volatility)).toBe(true);
      expect(result.volatility).toBeGreaterThan(0);
    });

    it('accepts custom tau parameter', () => {
      const player: Glicko2Rating = {
        rating: 1500,
        rd: 200,
        volatility: 0.06,
      };

      const matches: MatchResult[] = [
        { opponentRating: 1400, opponentRd: 30, score: 1.0 },
      ];

      const resultDefault = updateRating(player, matches);
      const resultHighTau = updateRating(player, matches, 1.2);

      // Higher tau allows more volatility change
      expect(resultDefault.rating).not.toBe(resultHighTau.rating);
    });
  });
});
