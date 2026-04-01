# Phase 18: Headless Match Runner - Research

**Researched:** 2026-04-01
**Domain:** Headless game simulation, bot agent framework, NDJSON match logging
**Confidence:** HIGH

## Summary

Phase 18 delivers a new `packages/bot-harness` package that runs complete RTS matches without Socket.IO by driving the existing `RtsRoom` API directly. The RtsRoom class already exposes every method needed: `create()`, `addPlayer()`, `queueBuildEvent()`, `queueDestroyEvent()`, `tick()`, and `createCanonicalMatchOutcome()`. The headless runner bypasses the lobby/countdown lifecycle entirely -- it creates a room, adds two bot players, then immediately begins a tick loop calling `room.tick()` until an outcome is produced or a max-tick limit is hit.

The `RtsRoom` API is fully deterministic: room ID controls `spawnOrientationSeed` (via `hashSpawnSeed`), so using the same room ID (derived from seed) produces identical spawn positions, and the tick loop is pure computation with no async/timer dependencies. This makes seed-based determinism verification straightforward.

Match logging uses NDJSON (one JSON object per line) written via Node.js `fs` module. Each file is self-contained with metadata header, per-tick records, and a final outcome line. The existing `createDeterminismCheckpoint()` method produces fnv1a-32 hashes that can be embedded periodically in the log for offline verification.

**Primary recommendation:** Build `packages/bot-harness` as a pure, runtime-agnostic package importing from `#rts-engine` and `#conway-core`. The runner is a synchronous tick loop (no async needed for simulation). File I/O for logging is the only async/Node.js concern and should be isolated to a separate logging module. CLI entry point lives in a `bin/` directory at project root or within the package.

<user_constraints>

## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Use a `BotStrategy` interface with a `decideTick(view, teamId)` method returning build/destroy actions. Runner calls it every tick.
- **D-02:** Bot receives a filtered view -- own team state only (economy, structures, build queue) plus the full shared grid. Opponent team internals (resources, queue) are hidden.
- **D-03:** Ship two built-in strategies: `RandomBot` (places valid random structures) and `NoOpBot` (never builds). Phase 19 adds the RL-ready bot.
- **D-04:** Bots decide every tick. No configurable action interval.
- **D-05:** One NDJSON file per match. First line: match metadata (seed, config, bot names). Then one line per tick with: tick number, actions queued/applied (template, position, transform, result), economy state, structure changes. Final line: match outcome.
- **D-06:** Include full build orders per tick -- template, position, transform, and result. Essential for Phase 21 strategy classification and Phase 22 structure ratings.
- **D-07:** Include fnv1a-32 determinism hash (from `createDeterminismCheckpoint()`) every N ticks in the log, enabling offline determinism verification without re-running.
- **D-08:** File organization: `matches/<run-id>/match-<N>.ndjson`. Run ID includes timestamp + seed for traceability.
- **D-09:** Skip lobby/countdown entirely. Runner creates room, adds bot players, then directly starts ticking. Match lifecycle state machine stays untouched.
- **D-10:** Configurable max tick limit with sensible default. Draw outcome if limit hit. Prevents infinite matches from stalling batch runs.
- **D-11:** New package `packages/bot-harness` -- separate from rts-engine. Imports from rts-engine and conway-core. Phases 19-23 extend this package.
- **D-12:** Runner accepts optional `onMatchComplete`/`onTickComplete` callbacks for progress tracking. No EventEmitter.
- **D-13:** CLI entry point (`bin/run-matches.ts`) invocable via npx/tsx. Flags: `--count`, `--seed`, `--max-ticks`, `--output-dir`, `--grid-size`, `--dry-run`.
- **D-14:** Sequential match execution in Phase 18. Phase 20 adds worker_threads parallelism.
- **D-15:** `--dry-run` mode runs matches without persisting log files.
- **D-16:** Seed control: `--seed 42` with `--count 10` produces seeds 42, 43, ..., 51. Each match file records its actual seed.

### Claude's Discretion
- Default max tick limit value (e.g., 2000 or whatever makes sense for typical match length)
- Hash checkpoint interval (every N ticks)
- Exact NDJSON field names and schema details
- Internal package structure within `packages/bot-harness`
- CLI parsing library choice (minimist, commander, yargs, or manual)

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope.

</user_constraints>

<phase_requirements>

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| HARN-01 | Headless match runner executes a full match between two bot agents using RtsRoom API without Socket.IO | RtsRoom.create() -> addPlayer() -> tick() loop -> createCanonicalMatchOutcome(). All methods verified in rts.ts. No Socket.IO dependency needed. |
| BAL-01 | Match database logs match outcomes, build orders, and per-tick snapshots from headless simulations | NDJSON format per D-05/D-06/D-07. RoomTickResult provides buildOutcomes/destroyOutcomes per tick. createDeterminismCheckpoint() provides hash trail. createRoomStatePayload() provides full state snapshots. |

</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Node.js `fs/promises` | Built-in (Node 24.13.0) | NDJSON file writing | No external dependency needed for line-oriented JSON output |
| Node.js `path` | Built-in | File path construction | Standard path handling |
| `#rts-engine` | In-repo | Game simulation API | RtsRoom, RtsEngine, all game types |
| `#conway-core` | In-repo | Grid operations | Grid class for Conway simulation |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `node:crypto` | Built-in | PRNG seed -> room ID generation | Deriving deterministic room IDs from integer seeds |
| `node:process` | Built-in | CLI argv parsing, exit codes | CLI entry point |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Manual argv parsing | `commander`/`yargs` | External dep adds bundle weight; manual `parseArgs` from `node:util` is sufficient for 6 flags and zero-dependency |
| NDJSON file writes | SQLite/LevelDB | Over-engineered for Phase 18; NDJSON is grep-friendly, append-only, trivially parseable. SQLite can be considered in Phase 21+ if query patterns demand it |
| `JSON.stringify` per line | Streaming JSON library | NDJSON is just `JSON.stringify(obj) + '\n'` -- no library needed |

**Installation:**
```bash
# No new npm packages required. All dependencies are built-in Node.js or in-repo packages.
```

**Version verification:** No external packages to verify. Node.js 24.13.0 includes `node:util` `parseArgs` (stable since Node 18.3.0).

## Architecture Patterns

### Recommended Package Structure
```
packages/bot-harness/
  index.ts              # Public API barrel export
  bot-strategy.ts       # BotStrategy interface + BotView type
  match-runner.ts       # HeadlessMatchRunner: tick loop, bot invocation, outcome
  match-logger.ts       # NDJSON file writer (MatchLogger class)
  random-bot.ts         # RandomBot strategy implementation
  noop-bot.ts           # NoOpBot strategy implementation
  seed.ts               # Seed -> room ID derivation, sequential seed generation
  types.ts              # Shared types (MatchConfig, MatchResult, TickRecord, etc.)
  match-runner.test.ts  # Unit tests for runner
  random-bot.test.ts    # Unit tests for RandomBot
  match-logger.test.ts  # Unit tests for logger
bin/
  run-matches.ts        # CLI entry point (at project root bin/ or packages/bot-harness/bin/)
```

### Pattern 1: BotStrategy Interface
**What:** A simple interface that receives a filtered view of the game state and returns zero or more build/destroy actions.
**When to use:** Every tick, for each bot player.
**Example:**
```typescript
// Source: D-01, D-02 from CONTEXT.md
export interface BotView {
  tick: number;
  grid: Grid;                      // Full shared grid (read-only)
  teamState: TeamStateView;        // Own team: resources, income, structures, pending builds
  templates: StructureTemplateSummary[];  // Available build templates
  roomWidth: number;
  roomHeight: number;
}

export interface TeamStateView {
  id: number;
  resources: number;
  income: number;
  incomeBreakdown: TeamIncomeBreakdown;
  structures: StructurePayload[];
  pendingBuilds: PendingBuildPayload[];
  defeated: boolean;
  baseTopLeft: Vector2;
}

export interface BotAction {
  type: 'build' | 'destroy';
  build?: BuildQueuePayload;
  destroy?: DestroyQueuePayload;
}

export interface BotStrategy {
  readonly name: string;
  decideTick(view: BotView, teamId: number): BotAction[];
}
```

### Pattern 2: Synchronous Tick Loop
**What:** The runner drives the simulation synchronously. No timers, no async between ticks. File I/O happens after the match completes (or via buffered writes).
**When to use:** All headless match execution.
**Example:**
```typescript
// Source: RtsRoom API from rts.ts
export interface MatchConfig {
  seed: number;
  gridWidth: number;
  gridHeight: number;
  maxTicks: number;
  hashCheckpointInterval: number;
}

export interface MatchResult {
  seed: number;
  config: MatchConfig;
  outcome: MatchOutcome | null;  // null = draw (max ticks reached)
  totalTicks: number;
  bots: [string, string];
  isDraw: boolean;
}

function runMatch(
  config: MatchConfig,
  botA: BotStrategy,
  botB: BotStrategy,
  callbacks?: MatchCallbacks,
): MatchResult {
  const roomId = seedToRoomId(config.seed);
  const room = RtsRoom.create({
    id: roomId,
    name: `headless-${roomId}`,
    width: config.gridWidth,
    height: config.gridHeight,
  });

  const teamA = room.addPlayer('bot-a', botA.name);
  const teamB = room.addPlayer('bot-b', botB.name);

  let lastOutcome: MatchOutcome | null = null;

  for (let tick = 0; tick < config.maxTicks; tick++) {
    // 1. Get bot decisions
    const viewA = createBotView(room, teamA.id);
    const viewB = createBotView(room, teamB.id);
    const actionsA = botA.decideTick(viewA, teamA.id);
    const actionsB = botB.decideTick(viewB, teamB.id);

    // 2. Submit actions to room
    applyBotActions(room, 'bot-a', actionsA);
    applyBotActions(room, 'bot-b', actionsB);

    // 3. Tick simulation
    const result = room.tick();

    // 4. Callback for progress/logging
    callbacks?.onTickComplete?.(tick, result);

    // 5. Check for match end
    if (result.outcome) {
      lastOutcome = result.outcome;
      break;
    }
  }

  return { seed: config.seed, config, outcome: lastOutcome, ... };
}
```

### Pattern 3: NDJSON Match Log
**What:** One JSON object per line. Header line, tick lines, footer line.
**When to use:** After each match completes (or streaming during match for large files).
**Example:**
```typescript
// Header line
{"type":"header","seed":42,"config":{...},"bots":["RandomBot","NoOpBot"],"startedAt":"..."}

// Tick lines
{"type":"tick","tick":0,"actions":[],"economy":[{"teamId":1,"resources":40,"income":0}],"buildOutcomes":[],"destroyOutcomes":[]}
{"type":"tick","tick":10,"actions":[{"teamId":1,"type":"build","templateId":"block","x":15,"y":20,"result":"applied"}],...,"hash":"a1b2c3d4"}

// Outcome line
{"type":"outcome","totalTicks":847,"winner":{"teamId":1,"rank":1},"ranked":[...],"isDraw":false}
```

### Pattern 4: Seed-to-RoomId Determinism
**What:** Convert integer seed to a deterministic string room ID. The room ID controls `spawnOrientationSeed` via `RtsEngine.hashSpawnSeed(id, width, height)`, which determines spawn positions.
**When to use:** Every match creation.
**Example:**
```typescript
// Simple approach: use seed directly as part of room ID string
function seedToRoomId(seed: number): string {
  return `headless-${seed.toString(36)}`;
}
// This produces consistent room IDs for the same seed.
// RtsEngine.hashSpawnSeed will then derive spawn orientation from this.
```

### Anti-Patterns to Avoid
- **Using async between ticks:** The tick loop is pure computation. Adding `await` or timers between ticks degrades throughput by orders of magnitude with no benefit.
- **Modifying RtsRoom/RtsEngine internals:** The bot harness MUST use only the public API. Do not reach into `RoomState` internals or `room-runtime.ts` WeakMap.
- **Storing full grid snapshots per tick in memory:** A 52x52 grid is ~338 bytes packed. At 2000 ticks that's only ~660KB, but storing full Grid objects is wasteful. Log only what's needed: actions, economy, outcomes. Grid snapshots only if explicitly requested.
- **Building a custom lifecycle state machine:** D-09 says skip lobby/countdown, NOT build a parallel lifecycle. Just call create -> addPlayer -> tick loop.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Build placement validation | Custom grid scanning for valid positions | `RtsRoom.previewBuildPlacement(playerId, payload)` | Already handles build zone, affordability, occupied sites, territory checks |
| Determinism hashing | Custom hash function | `room.createDeterminismCheckpoint()` | fnv1a-32 already implemented, covers grid + structures + economy |
| Match outcome computation | Custom win/loss detection | `result.outcome` from `room.tick()` | Handles defeat, draw, ranking, all edge cases |
| Team outcome snapshots | Manual stat collection | `room.createTeamOutcomeSnapshots()` | Consistent with server-side outcome reporting |
| Structure templates | Hardcoded template definitions | `createDefaultStructureTemplates()` from structure.ts | Single source of truth for game balance |
| Spawn position calculation | Manual coordinate math | `RtsRoom.addPlayer()` | Handles torus-wrapped spawn positioning automatically |
| CLI argument parsing | Custom string splitting | `node:util` `parseArgs` | Built-in, typed, handles flags/values/defaults |

**Key insight:** The RtsRoom API was designed to be self-contained. The server's Socket.IO layer is purely a transport wrapper. Every game operation the bot harness needs is already exposed as a synchronous method call on `RtsRoom`.

## Common Pitfalls

### Pitfall 1: RoomState Must Come from RtsEngine
**What goes wrong:** Attempting to construct a `RoomState` object manually or using `RtsRoom.fromState()` with a non-engine state throws `'RoomState must come from RtsEngine.createRoomState or RtsEngine.createRoom'`.
**Why it happens:** `RoomState` objects have a `RoomRuntime` attached via a WeakMap. Without this runtime, all operations fail.
**How to avoid:** Always use `RtsRoom.create(options)` or `RtsEngine.createRoom(options)` to create rooms.
**Warning signs:** Error message containing "must come from RtsEngine".

### Pitfall 2: Bot Actions After Match End
**What goes wrong:** Continuing to call `queueBuildEvent` or `tick()` after `result.outcome` is non-null leads to builds being rejected with `'match-finished'` reason. The tick loop must stop.
**Why it happens:** The engine drains all pending events when a match finishes. Subsequent queuing is rejected.
**How to avoid:** Break the tick loop immediately when `result.outcome !== null`.
**Warning signs:** All build outcomes showing `'match-finished'` rejection reason.

### Pitfall 3: Seed Determinism Depends on Room ID
**What goes wrong:** Using random room IDs for "seeded" runs produces different spawn positions each time, breaking reproducibility.
**Why it happens:** `RtsEngine.hashSpawnSeed(id, width, height)` derives the spawn orientation seed from the room ID string. Different IDs = different spawns = different games.
**How to avoid:** Derive room ID deterministically from the integer seed (e.g., `"headless-${seed}"`).
**Warning signs:** Same seed producing different match outcomes.

### Pitfall 4: RandomBot Placing Invalid Builds
**What goes wrong:** A naive random bot tries coordinates outside the build zone, gets rejected, wastes the entire tick budget on invalid placements.
**Why it happens:** Build zone is Euclidean-radius-limited around existing structures. Random grid coordinates have a low hit rate.
**How to avoid:** Use `previewBuildPlacement()` to validate before queuing, OR constrain random coordinates to within build radius of existing structures. Scanning a bounded region around the team's structures is much more efficient.
**Warning signs:** RandomBot's `rejectedBuildCount` being vastly higher than `appliedBuildCount`.

### Pitfall 5: Memory Leaks Across Multiple Matches
**What goes wrong:** Running 100+ matches in a single process accumulates Grid objects, RoomState references, and WeakMap entries.
**Why it happens:** `RtsRoom` uses `WeakMap<RoomState, RtsRoom>` for caching, so GC should handle cleanup -- but only if all references to RoomState are released. Holding onto match results that reference RoomState prevents collection.
**How to avoid:** Ensure match results contain only serializable data (not RoomState or Grid references). After each match, let the room and state go out of scope. Don't accumulate results in an array across a large batch -- write each to disk immediately.
**Warning signs:** Node.js heap growing linearly with match count.

### Pitfall 6: Package Import Alias Not Registered
**What goes wrong:** New `packages/bot-harness` tries to import `#rts-engine` but TypeScript or the runtime can't resolve it.
**Why it happens:** The `#rts-engine` alias is defined in `package.json` `imports` field and `tsconfig.base.json` `paths`. A new package using these aliases works automatically because all packages share the root config.
**How to avoid:** No action needed -- the existing alias configuration in `package.json` and `tsconfig.base.json` covers all packages under `packages/`. However, if a `#bot-harness` alias is desired, it must be added to both `package.json` `imports` and `tsconfig.base.json` `paths`.
**Warning signs:** Module resolution errors during `tsc` or vitest.

## Code Examples

Verified patterns from the codebase:

### Creating a Room and Adding Players (from rts.ts)
```typescript
// Source: packages/rts-engine/rts.ts lines 2124-2437
const room = RtsRoom.create({
  id: 'headless-42',
  name: 'Headless Match 42',
  width: 52,
  height: 52,
});

// addPlayer creates a team with core structure at a spawn position
const teamA = room.addPlayer('bot-a', 'RandomBot');
const teamB = room.addPlayer('bot-b', 'NoOpBot');

// teamA.id and teamB.id are assigned sequentially (1, 2)
// teamA.resources starts at DEFAULT_STARTING_RESOURCES (40)
// teamA.baseTopLeft has the spawn position
```

### Ticking and Checking Outcome (from rts.ts)
```typescript
// Source: packages/rts-engine/rts.ts lines 3186-3226, 3365-3367
const result: RoomTickResult = room.tick();

// result.buildOutcomes: BuildOutcome[] -- per-build results
// result.destroyOutcomes: DestroyOutcome[] -- per-destroy results
// result.appliedBuilds: number -- count of successful builds this tick
// result.defeatedTeams: number[] -- team IDs newly defeated this tick
// result.outcome: MatchOutcome | null -- non-null when match is over

if (result.outcome) {
  // result.outcome.winner: RankedTeamOutcome
  // result.outcome.ranked: RankedTeamOutcome[]
  // result.outcome.comparator: string (description of tiebreak rules)
}
```

### Queueing Build Events (from rts.ts)
```typescript
// Source: packages/rts-engine/rts.ts lines 2666-2780
const buildResult = room.queueBuildEvent('bot-a', {
  templateId: 'block',
  x: 15,
  y: 20,
  // transform is optional (defaults to identity)
  // delayTicks is optional (defaults to DEFAULT_QUEUE_DELAY_TICKS = 10)
});

if (buildResult.accepted) {
  // buildResult.eventId: number
  // buildResult.executeTick: number (when it will be applied)
}
```

### Preview Build Placement (from rts.ts)
```typescript
// Source: packages/rts-engine/rts.ts lines 2594-2664
const preview = room.previewBuildPlacement('bot-a', {
  templateId: 'generator',
  x: 10,
  y: 10,
});

// preview.accepted: boolean
// preview.reason?: BuildRejectionReason (if rejected)
// preview.footprint: Vector2[] (cells the template occupies)
// preview.illegalCells: Vector2[] (cells that overlap existing structures)
```

### Determinism Checkpoint (from rts.ts)
```typescript
// Source: packages/rts-engine/rts.ts lines 2938-2958
const checkpoint: RoomDeterminismCheckpoint = room.createDeterminismCheckpoint();
// checkpoint.tick: number
// checkpoint.generation: number
// checkpoint.hashAlgorithm: 'fnv1a-32'
// checkpoint.hashHex: string (e.g., 'a1b2c3d4')
```

### Getting Team State Payload (filtered view for bots)
```typescript
// Source: packages/rts-engine/rts.ts lines 3019-3035, 3327-3328
const payload = room.createStatePayload();
// payload.teams: TeamPayload[] -- all teams

// To create a filtered view for one bot:
const ownTeam = payload.teams.find(t => t.id === teamId);
// ownTeam.resources, ownTeam.income, ownTeam.structures, ownTeam.pendingBuilds, etc.
```

### Getting Available Templates
```typescript
// Source: packages/rts-engine/structure.ts line 475
// Templates are on room.state.templates (StructureTemplate[])
// Use room.getTemplate(templateId) to look up by ID
// Use StructureTemplate.toSummary() for bot-safe view

const summaries = room.state.templates.map(t => t.toSummary());
// Each summary: { id, name, width, height, activationCost, income, startingHp, buildRadius }
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `RtsEngine` static methods | `RtsRoom` instance methods | v0.0.2-v0.0.3 | Bot harness should use `RtsRoom` instance API exclusively |
| Direct `RoomState` construction | `RtsRoom.create()` factory | v0.0.2 | Must use factory; WeakMap-backed runtime is mandatory |
| Timer-driven ticks (server) | Synchronous `room.tick()` | Always available | Headless runner calls tick() directly, no timer needed |

**Deprecated/outdated:**
- Static `RtsEngine.tickRoom(room)`: Still works but prefer `room.tick()` instance method
- Static `RtsEngine.addPlayerToRoom(room, ...)`: Still works but prefer `room.addPlayer(...)` instance method

## Open Questions

1. **Default max tick limit value**
   - What we know: The default queue delay is 10 ticks. Integrity checks happen every 4 ticks. Core HP starts at 500. Income is 1/tick from core.
   - What's unclear: How many ticks a typical match lasts with RandomBot vs RandomBot. Likely 500-2000 ticks depending on build frequency.
   - Recommendation: Default to 2000 ticks. This gives ample time for games to conclude naturally. A NoOpBot-vs-NoOpBot game would be a guaranteed draw at any limit since neither acts. Recommend adding a brief calibration test during development.

2. **Hash checkpoint interval**
   - What we know: `createDeterminismCheckpoint()` computes fnv1a-32 over grid + structures + economy. Cost is proportional to grid size and structure count.
   - What's unclear: Exact computation cost per checkpoint on a 52x52 grid.
   - Recommendation: Every 50 ticks. At 2000 max ticks that's 40 checkpoints per match -- minimal overhead, sufficient for detecting drift.

3. **Should `#bot-harness` import alias be created?**
   - What we know: `#rts-engine` and `#conway-core` have aliases in package.json imports and tsconfig paths.
   - What's unclear: Whether Phases 19-23 will need to import from bot-harness via alias, or if direct relative imports suffice.
   - Recommendation: YES, create `#bot-harness` alias for consistency. Phases 19-23 will extend this package and likely import from it in tests and potentially in the server (Phase 23 bot adapter).

4. **CLI parsing approach**
   - What we know: Only 6 flags needed. `node:util` `parseArgs` is built-in since Node 18.3.
   - Recommendation: Use `node:util` `parseArgs`. Zero dependencies, sufficient for the flag set, type-safe.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | Runtime | Yes | 24.13.0 | -- |
| npm | Package management | Yes | 11.9.0 | -- |
| tsx | CLI entry point execution | Yes | ^4.15.0 (devDep) | -- |
| fs/promises | NDJSON writing | Yes | Built-in | -- |
| node:util parseArgs | CLI arg parsing | Yes | Built-in (stable since Node 18.3) | -- |

**Missing dependencies with no fallback:** None.
**Missing dependencies with fallback:** None.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 4.0.18 |
| Config file | `vitest.config.ts` (root) |
| Quick run command | `npx vitest run --dir packages/bot-harness` |
| Full suite command | `npm run test:unit` (covers all packages) |

### Phase Requirements to Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| HARN-01 | Two bots play a complete match via RtsRoom API, no Socket.IO | unit | `npx vitest run packages/bot-harness/match-runner.test.ts -x` | Wave 0 |
| HARN-01 | Match transitions from creation to finished state | unit | `npx vitest run packages/bot-harness/match-runner.test.ts -x` | Wave 0 |
| HARN-01 | NoOpBot vs NoOpBot produces draw at max ticks | unit | `npx vitest run packages/bot-harness/match-runner.test.ts -x` | Wave 0 |
| BAL-01 | NDJSON log contains header, tick records, and outcome line | unit | `npx vitest run packages/bot-harness/match-logger.test.ts -x` | Wave 0 |
| BAL-01 | Build orders recorded with template, position, transform, result | unit | `npx vitest run packages/bot-harness/match-logger.test.ts -x` | Wave 0 |
| BAL-01 | Determinism hash embedded at configured interval | unit | `npx vitest run packages/bot-harness/match-runner.test.ts -x` | Wave 0 |
| HARN-01 | Same seed produces identical match results (determinism) | unit | `npx vitest run packages/bot-harness/match-runner.test.ts -x` | Wave 0 |
| HARN-01 | Multiple matches run without resource leaks | unit | `npx vitest run packages/bot-harness/match-runner.test.ts -x` | Wave 0 |
| HARN-01 | RandomBot places valid structures within build zone | unit | `npx vitest run packages/bot-harness/random-bot.test.ts -x` | Wave 0 |

### Sampling Rate
- **Per task commit:** `npx vitest run --dir packages/bot-harness`
- **Per wave merge:** `npm run test:fast`
- **Phase gate:** `npm run test:quality` (full suite green)

### Wave 0 Gaps
- [ ] `packages/bot-harness/match-runner.test.ts` -- covers HARN-01 (match lifecycle, determinism, no leaks)
- [ ] `packages/bot-harness/match-logger.test.ts` -- covers BAL-01 (NDJSON format, build orders, hash trail)
- [ ] `packages/bot-harness/random-bot.test.ts` -- covers HARN-01 (valid placements)
- [ ] vitest.config.ts alias: add `#bot-harness` alias if import alias is created
- [ ] tsconfig.base.json paths: add `#bot-harness` path mapping
- [ ] package.json imports: add `#bot-harness` import mapping

## Sources

### Primary (HIGH confidence)
- `packages/rts-engine/rts.ts` -- RtsRoom class (line 3228+), RtsEngine class (line 467+), RoomState interface (line 256), RoomTickResult (line 383), CreateRoomOptions (line 400), BuildQueuePayload (line 64), RoomDeterminismCheckpoint (line 393)
- `packages/rts-engine/match-lifecycle.ts` -- MatchOutcome interface, TeamOutcomeSnapshot, RankedTeamOutcome, lifecycle state machine
- `packages/rts-engine/room-runtime.ts` -- RoomRuntime WeakMap pattern, INVALID_ROOM_STATE_ERROR_MESSAGE
- `packages/rts-engine/structure.ts` -- createDefaultStructureTemplates(), StructureTemplate class, StructurePayload interface
- `packages/rts-engine/gameplay-rules.ts` -- DEFAULT_STARTING_RESOURCES (40), DEFAULT_QUEUE_DELAY_TICKS (10), INTEGRITY_CHECK_INTERVAL_TICKS (4)
- `packages/rts-engine/rts-test-support.ts` -- Existing test helper patterns
- `package.json` -- Import aliases configuration, existing scripts
- `tsconfig.base.json` -- Path aliases configuration
- `vitest.config.ts` -- Test alias resolution, test include/exclude patterns
- `eslint.config.mjs` -- Lint scope includes `packages/**/*.ts`

### Secondary (MEDIUM confidence)
- Node.js `parseArgs` documentation -- stable API since Node 18.3, verified available on Node 24.13.0

### Tertiary (LOW confidence)
- None

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- all dependencies are built-in Node.js or existing in-repo packages; no external libraries needed
- Architecture: HIGH -- RtsRoom API is fully documented in the codebase; the pattern of creating rooms, adding players, and ticking is well-established in existing tests
- Pitfalls: HIGH -- identified from direct code inspection of WeakMap patterns, lifecycle constraints, and build zone mechanics

**Research date:** 2026-04-01
**Valid until:** 2026-05-01 (stable -- no external dependencies to drift)
