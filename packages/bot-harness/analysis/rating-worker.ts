/**
 * Worker thread entry point for parallel Glicko-2 pool computation.
 *
 * NO TF.js import -- this is pure math only. Receives serialized pool
 * data, creates a RatingPool, runs batch update, and returns results.
 *
 * Follows Phase 20's training-worker.ts message protocol pattern.
 * Uses _worker-shim.mjs for tsx TypeScript loading in worker threads.
 */
import { parentPort } from 'node:worker_threads';

import { RatingPool } from './rating-pool.js';
import type {
  Glicko2Rating,
  RatingPoolConfig,
  TemplateEncounter,
} from './types.js';

// ---------------------------------------------------------------------------
// Message protocol types
// ---------------------------------------------------------------------------

/** Sent from coordinator to compute a single pool's ratings. */
export interface ComputePoolMessage {
  type: 'compute-pool';
  poolConfig: RatingPoolConfig;
  entities: Array<{ id: string; rating: Glicko2Rating }>;
  encounters: TemplateEncounter[];
  tau: number;
}

/** Sent from worker back to coordinator with pool results. */
export interface PoolResultMessage {
  type: 'pool-result';
  poolName: string;
  entities: Array<{
    id: string;
    rating: Glicko2Rating;
    matchCount: number;
    pickRate: number;
  }>;
}

/** Sent from coordinator to terminate the worker. */
export interface TerminateWorkerMessage {
  type: 'terminate';
}

/** Union of all messages the worker can receive. */
export type RatingWorkerMessage = ComputePoolMessage | TerminateWorkerMessage;

// ---------------------------------------------------------------------------
// Message handler
// ---------------------------------------------------------------------------

if (parentPort) {
  parentPort.on('message', (msg: RatingWorkerMessage) => {
    switch (msg.type) {
      case 'compute-pool': {
        const pool = new RatingPool(msg.poolConfig, msg.tau);

        // Register pre-existing entities with their current ratings
        for (const entity of msg.entities) {
          pool.registerEntity(entity.id);
        }

        // Add encounters and run batch update
        pool.addEncounters(msg.encounters);
        pool.runUpdate();

        // Get rated entities and convert to plain serializable objects
        const ratedEntities = pool.getRatedEntities();
        const result: PoolResultMessage = {
          type: 'pool-result',
          poolName: msg.poolConfig.name,
          entities: ratedEntities.map((e) => ({
            id: e.id,
            rating: {
              rating: e.rating.rating,
              rd: e.rating.rd,
              volatility: e.rating.volatility,
            },
            matchCount: e.matchCount,
            pickRate: e.pickRate,
          })),
        };

        parentPort!.postMessage(result);
        break;
      }

      case 'terminate': {
        process.exit(0);
        break;
      }
    }
  });
}
