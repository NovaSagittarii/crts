# Codebase Concerns

**Analysis Date:** 2026-02-27

## Tech Debt

**Cross-layer event contract duplication:**

- Issue: Socket payload and state interfaces are duplicated across runtime and test layers instead of imported from one shared contract source.
- Files: `packages/rts-engine/src/rts.ts`, `apps/server/src/server.ts`, `apps/web/src/client.ts`, `tests/integration/server/server.test.ts`
- Impact: Contract drift causes runtime-only failures when one layer changes event fields or payload shape.
- Fix approach: Export and consume shared DTO types from `packages/rts-engine/src/rts.ts` (or a dedicated contracts package) in server, client, and tests.

**Large, mixed-responsibility modules:**

- Issue: Core runtime and engine logic are concentrated in large files that combine validation, state transitions, and transport concerns.
- Files: `packages/rts-engine/src/rts.ts`, `apps/server/src/server.ts`, `apps/web/src/client.ts`
- Impact: Small behavior changes require edits in high-churn files, increasing regression risk and review complexity.
- Fix approach: Split by responsibility (room lifecycle, queue/economy, socket handlers, rendering/UI controls) with narrow exported APIs.

**Type-checking workflow gap for web code:**

- Issue: Root typecheck excludes web sources and there is no explicit `typecheck` script that validates `tsconfig.client.json`.
- Files: `tsconfig.json`, `tsconfig.client.json`, `package.json`
- Impact: Client type regressions surface late in runtime or bundling instead of failing a dedicated typecheck step.
- Fix approach: Add `npm run typecheck` that runs `tsc -p tsconfig.json` and `tsc -p tsconfig.client.json`, then gate CI on it.

**Unused session registry state:**

- Issue: Session data is stored and deleted but not read for any runtime behavior.
- Files: `apps/server/src/server.ts`
- Impact: Dead state increases cognitive overhead and implies missing features (reconnect/session lookup) that are not actually implemented.
- Fix approach: Remove the `sessions` map or wire it to explicit reconnect/profile features.

## Known Bugs

**Accepted builds can disappear without failure feedback:**

- Symptoms: A client receives `build:queued`, but the queued build never applies and no event indicates execution-time rejection.
- Files: `packages/rts-engine/src/rts.ts`, `apps/server/src/server.ts`, `apps/web/src/client.ts`
- Trigger: Queue a build that becomes unaffordable or invalid at execution tick (for example territory/rules no longer pass).
- Workaround: Manually monitor room state/resources and requeue failed builds.

**Player profile event is emitted but not consumed by the client:**

- Symptoms: Server canonicalizes/sanitizes player names and emits `player:profile`, but UI state does not subscribe to that event.
- Files: `apps/server/src/server.ts`, `apps/web/src/client.ts`
- Trigger: Set a name that the server trims/normalizes (for example whitespace-padded or over max length input).
- Workaround: Enter the exact server-accepted value manually in the input field.

## Security Considerations

**Unauthenticated socket actions:**

- Risk: Any connected client can join rooms and mutate shared simulation state through `cell:update` and `build:queue`.
- Files: `apps/server/src/server.ts`
- Current mitigation: Basic payload shape checks and coordinate bounds checks.
- Recommendations: Require authenticated identity on connect and enforce per-room/team authorization on mutating events.

**No anti-abuse controls for event frequency or queue size:**

- Risk: High-rate event spam can saturate CPU/memory and degrade room responsiveness.
- Files: `apps/server/src/server.ts`, `packages/rts-engine/src/rts.ts`
- Current mitigation: None detected for per-socket rate limiting, throttling, or queue caps.
- Recommendations: Add per-socket rate limits, bounded queue lengths, and disconnect policy for abusive clients.

**Secret-commit guardrails are absent in ignore rules:**

- Risk: Environment and credential files are not ignored by default and can be committed accidentally.
- Files: `.gitignore`
- Current mitigation: Not detected in repository-level ignore configuration.
- Recommendations: Add `.env`/credential patterns to `.gitignore` and enforce pre-commit secret scanning.

## Performance Bottlenecks

**Full-grid simulation plus full-grid broadcast every tick:**

- Problem: Server computes Conway transitions across entire room grids and sends encoded full-state payloads on cadence.
- Files: `packages/conway-core/src/grid.ts`, `packages/rts-engine/src/rts.ts`, `apps/server/src/server.ts`
- Cause: O(width\*height) stepping with full base64 grid payload emission on each room update.
- Improvement path: Use delta/chunk updates, compress transport payloads, and adapt tick/update frequency by room activity.

**Client decodes and redraws entire board for each state event:**

- Problem: Browser decodes full base64 grid and redraws all visible cells per state update.
- Files: `apps/web/src/client.ts`
- Cause: Full decode path plus nested render loops and `resizeCanvas()` invocation in every `state` handler.
- Improvement path: Resize only on dimension change, render on `requestAnimationFrame`, and apply diff-based drawing.

**Build queue insertion and processing cost grows with event count:**

- Problem: Pending build events are sorted on each enqueue and scanned each tick.
- Files: `packages/rts-engine/src/rts.ts`
- Cause: Array sort per insert and linear queue scans in `applyTeamEconomyAndQueue`.
- Improvement path: Use execute-tick indexed buckets or a min-heap and enforce queue ceilings.

## Fragile Areas

**Server runtime orchestrator (`apps/server/src/server.ts`):**

- Files: `apps/server/src/server.ts`, `tests/integration/server/server.test.ts`
- Why fragile: Socket contract handling, room lifecycle, tick scheduling, and static serving are tightly coupled in one module.
- Safe modification: Isolate one event flow per change and back it with integration tests that assert observable socket behavior.
- Test coverage: Happy-path room flows are covered; malformed payload and reconnect edge cases are sparse.

**RTS rules engine core (`packages/rts-engine/src/rts.ts`):**

- Files: `packages/rts-engine/src/rts.ts`, `packages/rts-engine/test/rts.test.ts`
- Why fragile: Spawn logic, economy, queue execution, defeat detection, and payload serialization are interdependent.
- Safe modification: Extract pure functions with narrow inputs and add focused unit tests for each rule transition.
- Test coverage: Spawn exhaustion, high queue pressure, and execution-time rejection signaling are not explicitly covered.

**Integration teardown resilience (`tests/integration/server/server.test.ts`):**

- Files: `tests/integration/server/server.test.ts`
- Why fragile: Cleanup is inline per test instead of centralized in `afterEach`, so early assertion failures can leak sockets/servers.
- Safe modification: Track created servers/clients in test scope and enforce teardown in `afterEach`.
- Test coverage: Teardown-failure behavior is not verified.

## Scaling Limits

**Spawn allocation capacity (`packages/rts-engine/src/rts.ts`):**

- Current capacity: Bounded by fixed candidate coordinates and stepped room scan in `pickSpawnPosition`.
- Limit: When all scanned spawn slots are occupied, fallback returns `{ x: 0, y: 0 }`, causing overlapping team bases.
- Scaling path: Maintain explicit spawn occupancy index, reject joins when no safe spawn remains, or auto-create overflow rooms.

**Per-room network throughput (`packages/rts-engine/src/rts.ts`, `apps/server/src/server.ts`):**

- Current capacity: Throughput grows linearly with grid area, tick rate, and connected clients because state payloads include full grid snapshots.
- Limit: Larger grids and higher concurrency push bandwidth and serialization CPU beyond single-process limits.
- Scaling path: Send incremental diffs, shard rooms across processes, and tune tick rates by room load.

**In-memory room lifecycle (`apps/server/src/server.ts`):**

- Current capacity: Room, player, and team state live in process memory only.
- Limit: Room count and queue growth increase memory pressure and reset on process restart.
- Scaling path: Add room caps/eviction policy and external state storage for horizontal scaling.

## Dependencies at Risk

**`socket.io` + `socket.io-client` version coupling:**

- Risk: Server and client packages use different minor versions, increasing upgrade drift risk for transport behavior and defaults.
- Files: `package.json`, `tests/integration/server/server.test.ts`
- Impact: Event transport incompatibilities can surface at runtime under version skew.
- Migration plan: Pin and upgrade `socket.io` and `socket.io-client` together in `package.json` with integration test validation.

**Caret-ranged runtime/build dependencies:**

- Risk: Core dependencies use `^` ranges, allowing semver-minor upgrades that can shift behavior between installs.
- Files: `package.json`, `package-lock.json`
- Impact: Build/runtime instability appears without code changes when dependency graph updates.
- Migration plan: Use exact versions in `package.json` and schedule controlled dependency update batches.

## Missing Critical Features

**Authentication and authorization layer:**

- Problem: No verified identity or permission model exists for socket actions.
- Files: `apps/server/src/server.ts`, `apps/web/src/client.ts`
- Blocks: Secure matchmaking, trust boundaries, moderation, and role-based controls.

**Server-side abuse protection:**

- Problem: No rate limiting, queue bounds, or flood controls are implemented for mutating events.
- Files: `apps/server/src/server.ts`, `packages/rts-engine/src/rts.ts`
- Blocks: Safe internet-facing deployment and predictable multi-tenant stability.

**Persistent room state and recovery:**

- Problem: Simulation and room metadata are transient in-memory structures.
- Files: `apps/server/src/server.ts`, `packages/rts-engine/src/rts.ts`
- Blocks: Crash recovery, long-running matches, and horizontal scale-out.

**Shared runtime schema validation for socket payloads:**

- Problem: Payload parsing relies on ad hoc checks instead of shared runtime schemas.
- Files: `apps/server/src/server.ts`, `apps/web/src/client.ts`, `packages/rts-engine/src/rts.ts`
- Blocks: Independent client/server evolution with robust backward compatibility.

## Test Coverage Gaps

**Web client behavior is untested:**

- What's not tested: Canvas pointer interactions, template mode UX, room list rendering, and message/event UI synchronization.
- Files: `apps/web/src/client.ts`, `apps/web/index.html`
- Risk: UI regressions and client-only logic errors ship without automated detection.
- Priority: High

**Socket payload hardening paths are under-tested:**

- What's not tested: Malformed/abusive payload scenarios for `player:set-name`, `room:create`, `room:join`, `build:queue`, and `cell:update`.
- Files: `apps/server/src/server.ts`, `tests/integration/server/server.test.ts`
- Risk: Validation regressions and abuse vectors are not caught by automated tests.
- Priority: High

**Spawn exhaustion and overlap behavior are untested:**

- What's not tested: Team joins after all spawn candidates are occupied and fallback position collisions.
- Files: `packages/rts-engine/src/rts.ts`, `packages/rts-engine/test/rts.test.ts`
- Risk: High-player rooms can produce overlapping bases without detection.
- Priority: High

**Execution-time queue rejection signaling is untested:**

- What's not tested: Cases where `build:queued` is emitted but build execution is skipped at runtime due to changing constraints.
- Files: `packages/rts-engine/src/rts.ts`, `apps/server/src/server.ts`, `tests/integration/server/server.test.ts`
- Risk: Client/server state expectations diverge without observable failure events.
- Priority: Medium

---

_Concerns audit: 2026-02-27_
