/**
 * Glicko-2 rating engine implementing Glickman's 8-step algorithm.
 *
 * Pure math module -- no I/O, no side effects. Each call to updateRating
 * takes a player's current rating + a list of match results and returns
 * the updated rating. All computation uses the Glicko-2 internal scale
 * (mu/phi) and converts back to display scale (rating/rd) at the end.
 *
 * Reference: Glickman, M. E. (2013). Example of the Glicko-2 system.
 * http://www.glicko.net/glicko/glicko2.pdf
 */
import type { Glicko2MatchResult, Glicko2Rating } from './types.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default Glicko-2 hyperparameters */
export const GLICKO2_DEFAULTS = {
  initialRating: 1500,
  initialRd: 350,
  initialVolatility: 0.06,
  tau: 0.5,
  convergenceTol: 1e-6,
  scaleFactor: 173.7178, // 400 / ln(10)
} as const;

const SCALE = GLICKO2_DEFAULTS.scaleFactor;
const PI2 = Math.PI * Math.PI;
const MAX_ITERATIONS = 100;

// ---------------------------------------------------------------------------
// Internal helpers (not exported)
// ---------------------------------------------------------------------------

/** Step 2: g(phi) -- reduces weight of opponents with high RD */
function g(phi: number): number {
  return 1 / Math.sqrt(1 + (3 * phi * phi) / PI2);
}

/** Step 2: E(mu, muJ, phiJ) -- expected score */
function E(mu: number, muJ: number, phiJ: number): number {
  return 1 / (1 + Math.exp(-g(phiJ) * (mu - muJ)));
}

/** Opponent on Glicko-2 scale for internal computation */
interface ScaledOpponent {
  muJ: number;
  phiJ: number;
  gPhiJ: number;
  eVal: number;
  score: number;
}

/** Step 3: Compute estimated variance v */
function computeVariance(opponents: ScaledOpponent[]): number {
  let sum = 0;
  for (const opp of opponents) {
    sum += opp.gPhiJ * opp.gPhiJ * opp.eVal * (1 - opp.eVal);
  }
  return 1 / sum;
}

// ---------------------------------------------------------------------------
// Exported API
// ---------------------------------------------------------------------------

/**
 * Update a player's Glicko-2 rating given their match results for a period.
 *
 * Implements Glickman's 8-step procedure:
 * - Steps 1-2: Convert to Glicko-2 scale, compute g() and E()
 * - Step 3: Estimated variance v
 * - Step 4: Estimated improvement delta
 * - Step 5: New volatility via Illinois algorithm
 * - Step 6: Pre-rating period RD (phi*)
 * - Step 7: New rating and RD
 * - Step 8: Convert back to display scale
 *
 * If matches is empty, only RD increases (Step 6 with no volatility change).
 *
 * @param player  Current rating (display scale)
 * @param matches Match results for this rating period
 * @param tau     System constant constraining volatility change (default 0.5)
 * @returns       Updated rating (display scale)
 */
export function updateRating(
  player: Glicko2Rating,
  matches: Glicko2MatchResult[],
  tau: number = GLICKO2_DEFAULTS.tau,
): Glicko2Rating {
  // Step 1: Convert to Glicko-2 scale
  const mu = (player.rating - GLICKO2_DEFAULTS.initialRating) / SCALE;
  const phi = player.rd / SCALE;
  const sigma = player.volatility;

  // No matches: only RD increases (Step 6 only)
  if (matches.length === 0) {
    const phiStar = Math.sqrt(phi * phi + sigma * sigma);
    return {
      rating: player.rating,
      rd: phiStar * SCALE,
      volatility: sigma,
    };
  }

  // Step 2: Convert opponents and compute g(), E() for each
  const opponents: ScaledOpponent[] = matches.map((m) => {
    const muJ = (m.opponentRating - GLICKO2_DEFAULTS.initialRating) / SCALE;
    const phiJ = m.opponentRd / SCALE;
    const gPhiJ = g(phiJ);
    const eVal = E(mu, muJ, phiJ);
    return { muJ, phiJ, gPhiJ, eVal, score: m.score };
  });

  // Step 3: Estimated variance
  const v = computeVariance(opponents);

  // Step 4: Estimated improvement
  let deltaSum = 0;
  for (const opp of opponents) {
    deltaSum += opp.gPhiJ * (opp.score - opp.eVal);
  }
  const delta = v * deltaSum;

  // Step 5: Determine new volatility sigma' via Illinois algorithm
  const a = Math.log(sigma * sigma);
  const tau2 = tau * tau;
  const phi2 = phi * phi;
  const delta2 = delta * delta;

  // f(x) function from Glickman's paper
  const f = (x: number): number => {
    const ex = Math.exp(x);
    const denom = phi2 + v + ex;
    const left = (ex * (delta2 - phi2 - v - ex)) / (2 * denom * denom);
    const right = (x - a) / tau2;
    return left - right;
  };

  // Set initial values A and B
  let A = a;
  let B: number;

  if (delta2 > phi2 + v) {
    B = Math.log(delta2 - phi2 - v);
  } else {
    // Find k such that f(a - k*tau) < 0
    let k = 1;
    while (f(a - k * tau) < 0) {
      k++;
    }
    B = a - k * tau;
  }

  // Illinois algorithm iteration
  let fA = f(A);
  let fB = f(B);

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    if (Math.abs(B - A) <= GLICKO2_DEFAULTS.convergenceTol) {
      break;
    }

    const C = A + ((A - B) * fA) / (fB - fA);
    const fC = f(C);

    if (fC * fB <= 0) {
      A = B;
      fA = fB;
    } else {
      fA = fA / 2;
    }

    B = C;
    fB = fC;
  }

  const sigmaPrime = Math.exp(A / 2);

  // Step 6: Pre-rating period RD
  const phiStar = Math.sqrt(phi2 + sigmaPrime * sigmaPrime);

  // Step 7: New rating and RD
  const phiPrime = 1 / Math.sqrt(1 / (phiStar * phiStar) + 1 / v);
  const muPrime = mu + phiPrime * phiPrime * deltaSum;

  // Step 8: Convert back to display scale
  return {
    rating: muPrime * SCALE + GLICKO2_DEFAULTS.initialRating,
    rd: phiPrime * SCALE,
    volatility: sigmaPrime,
  };
}
