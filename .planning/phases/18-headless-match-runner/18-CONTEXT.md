# Phase 18: Headless Match Runner - Context

**Gathered:** 2026-04-01
**Status:** Ready for planning

<domain>
## Phase Boundary

Bot agents execute full matches against the RtsRoom API without Socket.IO, with match results persisted to NDJSON files for downstream analysis. This phase delivers the headless match runner, bot strategy interface, built-in bots (random + no-op), match logging, and a CLI entry point. It does NOT include the observation/action/reward Gymnasium interface (Phase 19), training pipeline (Phase 20), or balance analysis (Phase 21+).

</domain>

<decisions>
## Implementation Decisions

### Bot Agent Contract
- **D-01:** Use a `BotStrategy` interface with a `decideTick(view, teamId)` method returning build/destroy actions. Runner calls it every tick.
- **D-02:** Bot receives a filtered view — own team state only (economy, structures, build queue) plus the full shared grid. Opponent team internals (resources, queue) are hidden.
- **D-03:** Ship two built-in strategies: `RandomBot` (places valid random structures) and `NoOpBot` (never builds). Phase 19 adds the RL-ready bot.
- **D-04:** Bots decide every tick. No configurable action interval — downstream RL training (Phase 19) can throttle its own frequency.

### Match Logging Format
- **D-05:** One NDJSON file per match. First line: match metadata (seed, config, bot names). Then one line per tick with: tick number, actions queued/applied (template, position, transform, result), economy state, structure changes. Final line: match outcome.
- **D-06:** Include full build orders per tick — template, position, transform, and result. Essential for Phase 21 strategy classification and Phase 22 structure ratings.
- **D-07:** Include fnv1a-32 determinism hash (from `createDeterminismCheckpoint()`) every N ticks in the log, enabling offline determinism verification without re-running.
- **D-08:** File organization: `matches/<run-id>/match-<N>.ndjson`. Run ID includes timestamp + seed for traceability.

### Headless Lifecycle
- **D-09:** Skip lobby/countdown entirely. Runner creates room, adds bot players, then directly starts ticking. Match lifecycle state machine stays untouched — runner simply doesn't use the Socket.IO coordinator path.
- **D-10:** Configurable max tick limit with sensible default (e.g., 2000). Draw outcome if limit hit. Prevents infinite matches from stalling batch runs.
- **D-11:** New package `packages/bot-harness` — separate from rts-engine. Imports from rts-engine and conway-core. Phases 19-23 extend this package.
- **D-12:** Runner accepts optional `onMatchComplete`/`onTickComplete` callbacks for progress tracking. No EventEmitter — lightweight callbacks sufficient for CLI progress bars.

### Runner CLI / API
- **D-13:** CLI entry point (`bin/run-matches.ts`) invocable via npx/tsx. Flags: `--count`, `--seed`, `--max-ticks`, `--output-dir`, `--grid-size`, `--dry-run`.
- **D-14:** Sequential match execution in Phase 18. Phase 20 (TRAIN-04) adds worker_threads parallelism.
- **D-15:** `--dry-run` mode runs matches without persisting log files. Useful for smoke tests and benchmarking.
- **D-16:** Seed control: `--seed 42` with `--count 10` produces seeds 42, 43, ..., 51. Each match file records its actual seed. Reproducible batch runs.

### Claude's Discretion
- Default max tick limit value (e.g., 2000 or whatever makes sense for typical match length)
- Hash checkpoint interval (every N ticks)
- Exact NDJSON field names and schema details
- Internal package structure within `packages/bot-harness`
- CLI parsing library choice (minimist, commander, yargs, or manual)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### RTS Engine API
- `packages/rts-engine/rts.ts` — `RtsRoom` class (line ~3228), `RoomState` interface (line ~256), `RoomTickResult` (line ~383), `CreateRoomOptions` (line ~400)
- `packages/rts-engine/match-lifecycle.ts` — `MatchOutcome`, `TeamOutcomeSnapshot`, lifecycle state machine
- `packages/rts-engine/room-runtime.ts` — `RoomRuntime` internals, `createRoomRuntime`

### Conway Core
- `packages/conway-core/` — `Grid` class, `step()`, `toPacked()`/`fromPacked()`

### Determinism Infrastructure
- `packages/rts-engine/rts.ts` — `createDeterminismCheckpoint()`, `createStateHashes()`, `RoomDeterminismCheckpoint` (line ~393), fnv1a-32 hashing
- `packages/rts-engine/input-event-log.ts` — `InputEventLog` ring buffer (existing input replay infrastructure)

### Structure & Build System
- `packages/rts-engine/structure.ts` — `StructureTemplate`, `createDefaultStructureTemplates()`
- `packages/rts-engine/rts.ts` — `queueBuildEvent()`, `queueDestroyEvent()`, `BuildQueuePayload`, `DestroyQueuePayload`

### Testing Patterns
- `packages/rts-engine/rts-test-support.ts` — Existing test helpers and fixtures
- `tests/integration/server/fixtures.ts` — Integration test fixture builders

### Requirements
- `.planning/REQUIREMENTS.md` — HARN-01 (headless runner), BAL-01 (match logging)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `RtsRoom` class: Full match API — `create()`, `addPlayer()`, `queueBuildEvent()`, `queueDestroyEvent()`, `tick()`, `createCanonicalMatchOutcome()`, `createTeamOutcomeSnapshots()`
- `createDeterminismCheckpoint()`: fnv1a-32 hash for state verification — reuse for NDJSON hash trail
- `InputEventLog`: Ring buffer for input events — reference pattern for tick-level logging
- `createDefaultStructureTemplates()`: Default templates for room creation — bots need these for valid placements
- `rts-test-support.ts`: Existing test fixtures for room setup — pattern to follow for harness tests

### Established Patterns
- Package imports via `#conway-core` and `#rts-engine` aliases — new package should follow this pattern
- Explicit `.js` extensions in relative imports
- Vitest for testing with co-located test files in packages
- `RoomState` created via `RtsEngine.createRoomState()` or `RtsEngine.createRoom()` — required for `RtsRoom.fromState()`
- Determinism seeded via `spawnOrientationSeed` derived from room ID — room ID controls reproducibility

### Integration Points
- `RtsRoom.create(options)` → creates room with grid, templates, spawn layout
- `RtsRoom.addPlayer(playerId, name)` → assigns team with spawn position
- `RtsRoom.queueBuildEvent(playerId, payload)` → queues build action
- `RtsRoom.tick()` → advances simulation, returns `RoomTickResult` with `outcome` (null until match ends)
- `RtsRoom.createCanonicalMatchOutcome()` → winner/ranked teams after match ends

</code_context>

<specifics>
## Specific Ideas

- Bot filtered view: bot sees full grid + own team state only (economy, structures, queue). Opponent team internals hidden. This establishes the information asymmetry contract that Phase 19's observation encoder will formalize.
- NDJSON files should be self-contained — each file has enough metadata to replay or analyze without needing external config files.
- The `packages/bot-harness` package is the foundation for all v0.0.4 phases (19-23). Design the module boundary with extension in mind.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 18-headless-match-runner*
*Context gathered: 2026-04-01*
