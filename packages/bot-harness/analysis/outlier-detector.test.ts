import { describe, expect, it } from 'vitest';
import type { RatedEntity } from './types.js';
import { detectOutliers } from './outlier-detector.js';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeEntity(overrides: Partial<RatedEntity>): RatedEntity {
  return {
    id: 'test',
    name: 'test',
    entityType: 'individual',
    phase: 'full',
    rating: { rating: 1500, rd: 100, volatility: 0.06 },
    provisional: false,
    matchCount: 20,
    pickRate: 0.2,
    outlierFlags: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Outlier detector tests
// ---------------------------------------------------------------------------

describe('detectOutliers', () => {
  it('Test 7: statistical outlier high — entity >2 SD above mean', () => {
    // Use enough entities so one outlier doesn't dominate the mean/SD
    // 9 entities at 1500 + 1 entity at 2000
    // Mean = (1500*9 + 2000)/10 = 1550, SD = sqrt(((-50)^2*9 + 450^2)/10) = sqrt((22500+202500)/10) = sqrt(22500) = 150
    // Threshold = 1550 + 2*150 = 1850. D at 2000 > 1850 → outlier-high
    const entities: RatedEntity[] = [];
    for (let i = 0; i < 9; i++) {
      entities.push(
        makeEntity({ id: `E${i}`, rating: { rating: 1500, rd: 100, volatility: 0.06 }, pickRate: 0.1 }),
      );
    }
    entities.push(
      makeEntity({ id: 'D', rating: { rating: 2000, rd: 100, volatility: 0.06 }, pickRate: 0.1 }),
    );

    const result = detectOutliers(entities);
    const d = result.find((e) => e.id === 'D')!;

    expect(d.outlierFlags).toContain('statistical-outlier-high');
  });

  it('Test 8: statistical outlier low — entity >2 SD below mean', () => {
    // 9 entities at 1500 + 1 entity at 1000
    // Mean = (1500*9 + 1000)/10 = 1450, SD = sqrt((50^2*9 + (-450)^2)/10) = sqrt((22500+202500)/10) = 150
    // Threshold = 1450 - 2*150 = 1150. D at 1000 < 1150 → outlier-low
    const entities: RatedEntity[] = [];
    for (let i = 0; i < 9; i++) {
      entities.push(
        makeEntity({ id: `E${i}`, rating: { rating: 1500, rd: 100, volatility: 0.06 }, pickRate: 0.1 }),
      );
    }
    entities.push(
      makeEntity({ id: 'D', rating: { rating: 1000, rd: 100, volatility: 0.06 }, pickRate: 0.1 }),
    );

    const result = detectOutliers(entities);
    const d = result.find((e) => e.id === 'D')!;

    expect(d.outlierFlags).toContain('statistical-outlier-low');
  });

  it('Test 9: dominant — high rating AND high pick rate', () => {
    const entities: RatedEntity[] = [
      makeEntity({ id: 'A', rating: { rating: 1800, rd: 100, volatility: 0.06 }, pickRate: 0.4 }),
      makeEntity({ id: 'B', rating: { rating: 1200, rd: 100, volatility: 0.06 }, pickRate: 0.1 }),
      makeEntity({ id: 'C', rating: { rating: 1100, rd: 100, volatility: 0.06 }, pickRate: 0.3 }),
      makeEntity({ id: 'D', rating: { rating: 1400, rd: 100, volatility: 0.06 }, pickRate: 0.2 }),
    ];

    // Median rating: sort=[1100, 1200, 1400, 1800] → median = (1200+1400)/2 = 1300
    // Median pickRate: sort=[0.1, 0.2, 0.3, 0.4] → median = (0.2+0.3)/2 = 0.25
    // A: rating 1800 > 1300 AND pickRate 0.4 > 0.25 → dominant

    const result = detectOutliers(entities);
    const a = result.find((e) => e.id === 'A')!;

    expect(a.outlierFlags).toContain('dominant');
  });

  it('Test 10: niche-strong — high rating AND low pick rate', () => {
    const entities: RatedEntity[] = [
      makeEntity({ id: 'A', rating: { rating: 1800, rd: 100, volatility: 0.06 }, pickRate: 0.05 }),
      makeEntity({ id: 'B', rating: { rating: 1200, rd: 100, volatility: 0.06 }, pickRate: 0.4 }),
      makeEntity({ id: 'C', rating: { rating: 1300, rd: 100, volatility: 0.06 }, pickRate: 0.3 }),
      makeEntity({ id: 'D', rating: { rating: 1100, rd: 100, volatility: 0.06 }, pickRate: 0.25 }),
    ];

    // Median rating: sort=[1100, 1200, 1300, 1800] → median = (1200+1300)/2 = 1250
    // Median pickRate: sort=[0.05, 0.25, 0.3, 0.4] → median = (0.25+0.3)/2 = 0.275
    // A: rating 1800 > 1250 AND pickRate 0.05 < 0.275 → niche-strong

    const result = detectOutliers(entities);
    const a = result.find((e) => e.id === 'A')!;

    expect(a.outlierFlags).toContain('niche-strong');
  });

  it('Test 11: trap — low rating AND high pick rate', () => {
    const entities: RatedEntity[] = [
      makeEntity({ id: 'A', rating: { rating: 1000, rd: 100, volatility: 0.06 }, pickRate: 0.5 }),
      makeEntity({ id: 'B', rating: { rating: 1800, rd: 100, volatility: 0.06 }, pickRate: 0.1 }),
      makeEntity({ id: 'C', rating: { rating: 1700, rd: 100, volatility: 0.06 }, pickRate: 0.2 }),
      makeEntity({ id: 'D', rating: { rating: 1600, rd: 100, volatility: 0.06 }, pickRate: 0.2 }),
    ];

    // Median rating: sort=[1000, 1600, 1700, 1800] → median = (1600+1700)/2 = 1650
    // Median pickRate: sort=[0.1, 0.2, 0.2, 0.5] → median = (0.2+0.2)/2 = 0.2
    // A: rating 1000 < 1650 AND pickRate 0.5 > 0.2 → trap

    const result = detectOutliers(entities);
    const a = result.find((e) => e.id === 'A')!;

    expect(a.outlierFlags).toContain('trap');
  });

  it('Test 12: provisional entities excluded from statistical deviation calculation', () => {
    const entities: RatedEntity[] = [
      makeEntity({ id: 'A', rating: { rating: 1500, rd: 100, volatility: 0.06 }, provisional: false }),
      makeEntity({ id: 'B', rating: { rating: 1500, rd: 100, volatility: 0.06 }, provisional: false }),
      makeEntity({ id: 'C', rating: { rating: 1500, rd: 100, volatility: 0.06 }, provisional: false }),
      // Provisional entity with extremely high rating should not be flagged by SD method
      makeEntity({
        id: 'P',
        rating: { rating: 3000, rd: 200, volatility: 0.06 },
        provisional: true,
        pickRate: 0.01,
      }),
    ];

    const result = detectOutliers(entities);
    const p = result.find((e) => e.id === 'P')!;

    // Provisional entity should NOT have statistical-outlier-high flag
    expect(p.outlierFlags).not.toContain('statistical-outlier-high');
    expect(p.outlierFlags).not.toContain('statistical-outlier-low');
  });

  it('Test 13: multiple flags — entity can be both statistical-outlier-high and dominant', () => {
    // 9 entities at 1500 with low pick rate + 1 entity at 2000 with high pick rate
    // Mean = 1550, SD = 150, threshold = 1550 + 300 = 1850. A at 2000 > 1850 → stat-outlier-high
    // Median rating across 10 entities ≈ 1500. A at 2000 > 1500 → high rating
    // A has pickRate 0.5 which is > median pickRate → also dominant
    const entities: RatedEntity[] = [];
    for (let i = 0; i < 9; i++) {
      entities.push(
        makeEntity({ id: `E${i}`, rating: { rating: 1500, rd: 100, volatility: 0.06 }, pickRate: 0.05 }),
      );
    }
    entities.push(
      makeEntity({ id: 'A', rating: { rating: 2000, rd: 100, volatility: 0.06 }, pickRate: 0.5 }),
    );

    const result = detectOutliers(entities);
    const a = result.find((e) => e.id === 'A')!;

    expect(a.outlierFlags).toContain('statistical-outlier-high');
    expect(a.outlierFlags).toContain('dominant');
    expect(a.outlierFlags.length).toBeGreaterThanOrEqual(2);
  });
});
