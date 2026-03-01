# Phase 5: Quality Gate Validation - Research

**Researched:** 2026-03-01
**Domain:** Repeatable automated quality gates for deterministic multiplayer Conway + RTS validation
**Confidence:** HIGH

<user_constraints>

## User Constraints (from CONTEXT.md)

No `*-CONTEXT.md` file exists for this phase (`.planning/phases/05-quality-gate-validation`).

### Locked Decisions

- Implement repeatable automated validation for the multiplayer Conway + RTS loop.
- This phase MUST satisfy `QUAL-01` and `QUAL-02`.
- Unit coverage must include lobby/team invariants, queue validation, queue terminal outcomes, and economy rules.
- Integration coverage must include end-to-end flow: join -> build -> tick -> breach -> defeat.
- Keep deterministic gameplay logic in `packages/*` and runtime/socket lifecycle in `apps/*`.

### OpenCode's Discretion

- Whether to add new requirement-focused test files or map requirements onto existing tests.
- Whether to add a dedicated quality-gate command (for example `test:quality`) in addition to existing scripts.
- Whether integration tests should run with `--no-file-parallelism` for maximum repeatability.
- Whether to add coverage-threshold enforcement now or defer.

### Deferred Ideas (OUT OF SCOPE)

- Any gameplay expansion from v2 (`GAME-*` requirements).
- Network/runtime migrations (for example protobuf transport or non-Socket.IO stack).
- New user-facing gameplay features unrelated to validation gates.

</user_constraints>

<phase_requirements>

## Phase Requirements

| ID      | Description                                                                                                                 | Research Support                                                                                                                                                                                                                                                                             |
| ------- | --------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| QUAL-01 | Developers can run unit tests covering lobby/team invariants, queue validation, queue terminal outcomes, and economy rules. | Existing unit suites already cover all required domains in `packages/rts-engine/lobby.test.ts` and `packages/rts-engine/rts.test.ts`; Phase 5 should make this requirement mapping explicit and keep `npm run test:unit` as the repeatable gate.                                             |
| QUAL-02 | Developers can run integration tests covering end-to-end flow: join -> build -> tick -> breach -> defeat.                   | Existing integration coverage in `tests/integration/server/match-lifecycle.test.ts` and `tests/integration/server/server.test.ts` already exercises the core loop; Phase 5 should add one explicit requirement-tagged loop scenario and keep `npm run test:integration` as the gate command. |

</phase_requirements>

## Summary

The project already has substantial automated coverage: `npm run test:unit` currently passes 50 tests across package logic, and `npm run test:integration` passes 25 tests across Socket.IO runtime flows. Existing tests already cover most of QUAL-01 and QUAL-02 behavior, especially in `packages/rts-engine/lobby.test.ts`, `packages/rts-engine/rts.test.ts`, `tests/integration/server/match-lifecycle.test.ts`, and `tests/integration/server/server.test.ts`.

Phase 5 should therefore focus on **quality-gate hardening and traceability**, not new simulation features. The biggest gaps are operational: requirement-to-test mapping is implicit, integration helper patterns are duplicated, and one major file (`tests/integration/server/server.test.ts`) relies on per-test manual teardown instead of a central fixture lifecycle. These are common causes of flaky suites over time.

A practical gate split is already present (`test:unit` vs `test:integration`). Local measurements show unit runs are fast (~15s), while integration is significantly slower (~90s). Planning should preserve this split, improve deterministic integration harness patterns, and make at least one explicit QUAL-02 loop test easy to point at during verification.

**Primary recommendation:** Treat Phase 5 as a validation-hardening phase: keep Vitest + real Socket.IO integration tests, add explicit requirement-mapped scenarios (especially one clear join->build->tick->breach->defeat test), and stabilize integration execution/teardown so gate results stay repeatable.

## Standard Stack

### Core

| Library            | Version | Purpose                                       | Why Standard                                                                                   |
| ------------------ | ------- | --------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `vitest`           | 1.6.1   | Unit + integration test runner                | Already in use across package and server integration suites; supports scoped runs via `--dir`. |
| `socket.io`        | 4.8.3   | Real server transport under test              | Integration tests validate real event semantics and room-scoped broadcasts.                    |
| `socket.io-client` | 4.8.3   | Real client harness in integration tests      | Prevents false confidence from mocked transport behavior.                                      |
| `typescript`       | 5.9.3   | Contract/type safety in test and runtime code | Keeps payload assertions aligned with shared socket contract types.                            |
| `vite`             | 5.4.21  | Test transform/runtime plumbing for Vitest    | Existing toolchain baseline for current repository.                                            |

### Supporting

| Library                    | Version                  | Purpose                                                                      | When to Use                                                  |
| -------------------------- | ------------------------ | ---------------------------------------------------------------------------- | ------------------------------------------------------------ |
| In-repo `#rts-engine` APIs | current                  | Deterministic game invariants (`queueBuildEvent`, `tickRoom`, lobby helpers) | Unit validation for QUAL-01 domains.                         |
| In-repo `createServer()`   | current                  | Runtime-accurate Socket.IO server harness                                    | Integration flow coverage for QUAL-02.                       |
| `@vitest/coverage-v8`      | optional (not installed) | Coverage reports + threshold gates                                           | Use only if Phase 5 includes coverage threshold enforcement. |

### Alternatives Considered

| Instead of                                                           | Could Use                           | Tradeoff                                                                                         |
| -------------------------------------------------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------ |
| Real Socket.IO integration via `createServer()` + `socket.io-client` | Mocked transport/event bus          | Faster tests but misses delivery semantics, reconnection behavior, and room broadcast contracts. |
| Existing `--dir` script split (`test:unit`, `test:integration`)      | Vitest workspace projects           | Cleaner project labels but introduces additional config complexity for minimal immediate gain.   |
| Requirement-focused explicit loop test                               | Rely on broad regression files only | Broader coverage exists, but requirement traceability remains ambiguous for phase sign-off.      |

**Installation:**

```bash
npm install
# Optional only if adding coverage thresholds
npm install -D @vitest/coverage-v8
```

## Architecture Patterns

### Recommended Project Structure

```text
packages/rts-engine/
├── lobby.test.ts                  # lobby/team invariants and slot behavior
├── rts.test.ts                    # queue validation, terminal outcomes, economy rules
└── match-lifecycle.test.ts        # lifecycle and breach comparator determinism

tests/integration/server/
├── match-lifecycle.test.ts        # lifecycle and breach/defeat contract
├── server.test.ts                 # queue/state/runtime integration contracts
├── lobby-*.test.ts                # reconnect and membership reliability
└── quality-gate-loop.test.ts      # (recommended) explicit QUAL-02 traceability test

vitest.config.ts                   # shared Vitest config
package.json                       # gate commands (`test:unit`, `test:integration`)
```

### Pattern 1: Requirement-Mapped Unit Gate by Domain

**What:** Keep domain-specific deterministic logic in package-level unit tests and map each requirement area to explicit test groups.
**When to use:** QUAL-01 verification and regression prevention.
**Example:**

```typescript
// Source: packages/rts-engine/rts.test.ts
test('validates build queue payloads and delay clamping', () => {
  const outsideBounds = queueBuildEvent(room, 'p1', {
    templateId: 'block',
    x: 79,
    y: 79,
  });
  expect(outsideBounds.accepted).toBe(false);
});
```

### Pattern 2: Deterministic Integration Harness

**What:** Use ephemeral ports and bounded event waits; assert externally visible contract payloads only.
**When to use:** All Socket.IO integration tests.
**Example:**

```typescript
// Source: tests/integration/server/match-lifecycle.test.ts
server = createServer({ port: 0, width: 52, height: 52, tickMs: 40 });
port = await server.start();

const payload = await waitForEvent<RoomMembershipPayload>(
  socket,
  'room:membership',
  3000,
);
```

### Pattern 3: Explicit Full-Loop Scenario for QUAL-02

**What:** Keep one requirement-tagged integration test that follows join -> build -> tick -> breach -> defeat in sequence.
**When to use:** Phase sign-off and future regression triage.
**Example:**

```typescript
// Source: tests/integration/server/match-lifecycle.test.ts
match.guest.emit('build:queue', {
  templateId: 'glider',
  x: match.guestBaseTopLeft.x,
  y: match.guestBaseTopLeft.y,
  delayTicks: 1,
});

const finished = await waitForEvent<MatchFinishedPayload>(
  match.host,
  'room:match-finished',
  7000,
);
expect(finished.winner.outcome).toBe('winner');
```

### Pattern 4: Two-Tier Gate Commands

**What:** Keep quick deterministic unit loop and full integration loop as separate commands.
**When to use:** Fast local iteration vs pre-merge/full validation.
**Example:**

```json
// Source: package.json
{
  "test:unit": "vitest run --config vitest.config.ts --dir packages",
  "test:integration": "vitest run --config vitest.config.ts --dir tests/integration"
}
```

### Anti-Patterns to Avoid

- **Sleep-driven assertions:** avoid arbitrary `setTimeout` waits; always wait on explicit events/conditions.
- **Listener-after-emit race:** register response listeners before `emit` when immediate response is possible.
- **Teardown at happy-path only:** ensure server/socket cleanup executes even on assertion failure.
- **String-parsing contract checks:** assert `reason` and typed fields (`needed/current/deficit`) rather than human-readable message text.
- **Requirement coverage by implication:** broad passing tests are not enough; keep QUAL-specific mapping explicit.

## Don't Hand-Roll

| Problem                       | Don't Build                               | Use Instead                                                          | Why                                                                       |
| ----------------------------- | ----------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Transport simulation          | Custom fake event bus for integration     | Real `createServer()` + `socket.io-client`                           | Preserves actual ordering, room fanout, and reconnection semantics.       |
| Test execution orchestration  | Ad-hoc shell wrappers around node scripts | Vitest CLI (`vitest run`, `--dir`, optional `--no-file-parallelism`) | Standard runner behavior, filtering, and reporting are already available. |
| Coverage enforcement plumbing | Manual coverage parsing scripts           | Vitest coverage provider (`@vitest/coverage-v8`)                     | Built-in threshold/report support is less error-prone.                    |
| Socket payload contracts      | Per-test inline ad-hoc interfaces         | Shared `packages/rts-engine/socket-contract.ts` types                | Keeps server/client/tests synchronized and prevents drift.                |

**Key insight:** For this phase, reliability comes from deterministic test architecture and explicit requirement mapping, not from adding new gameplay logic.

## Common Pitfalls

### Pitfall 1: Event Listener Registration Races

**What goes wrong:** Tests intermittently time out waiting for events.
**Why it happens:** Response listener is attached after the request `emit`.
**How to avoid:** Create wait promise/listener first, then emit, then await.
**Warning signs:** Sporadic `Timed out waiting for ...` failures in otherwise stable tests.

### Pitfall 2: Resource Leaks on Failed Assertions

**What goes wrong:** Subsequent tests fail unpredictably or hang.
**Why it happens:** Cleanup code runs only at the end of happy-path test logic.
**How to avoid:** Centralize teardown in `afterEach` or `try/finally` for every integration path.
**Warning signs:** lingering sockets, hanging Vitest process, or nondeterministic integration failures.

### Pitfall 3: Implicit Requirement Coverage

**What goes wrong:** Tests pass but requirement sign-off remains unclear.
**Why it happens:** Requirements are covered indirectly across many files, not explicitly mapped.
**How to avoid:** Add requirement-focused test names/comments and a direct QUAL mapping in phase docs.
**Warning signs:** manual debates over whether QUAL-01/QUAL-02 are actually complete.

### Pitfall 4: Misunderstanding Delivery Guarantees

**What goes wrong:** Tests assume missed events are always replayed after reconnect.
**Why it happens:** Socket.IO guarantees ordering, but default delivery is at-most-once.
**How to avoid:** Validate authoritative state/membership snapshots and avoid dependence on one-shot event replay.
**Warning signs:** reconnect tests that flake only under network jitter/disconnect timing.

### Pitfall 5: Slow Full Gate Avoidance

**What goes wrong:** Developers skip integration validation because it feels too expensive.
**Why it happens:** Integration suite currently runs ~90s locally.
**How to avoid:** Keep two-tier gate usage guidance (quick unit loop, full integration before merge).
**Warning signs:** changes merged after only `test:unit` runs.

## Code Examples

Verified patterns from in-repo and official sources:

### Queue Validation and Affordability Rejection

```typescript
// Source: packages/rts-engine/rts.ts
if (!inBounds(room, x, y, template.width, template.height)) {
  rejectBuild(room, team, 'out-of-bounds');
  return {
    accepted: false,
    error: 'Placement is out of bounds',
    reason: 'out-of-bounds',
  };
}

const affordability = evaluateAffordability(needed, team.resources);
if (!affordability.affordable) {
  rejectBuild(room, team, 'insufficient-resources', undefined, affordability);
  return {
    accepted: false,
    reason: 'insufficient-resources',
    ...affordability,
  };
}
```

### Terminal Outcome Broadcast Is Room-Scoped

```typescript
// Source: apps/server/src/server.ts
function emitBuildOutcomes(
  room: RuntimeRoom,
  outcomes: BuildOutcomePayload[],
): void {
  for (const outcome of outcomes) {
    io.to(roomChannel(room.state.id)).emit('build:outcome', outcome);
  }
}
```

### Socket.IO Delivery Semantics to Design Assertions

```typescript
// Source: https://socket.io/docs/v4/delivery-guarantees/
// Ordering is guaranteed, arrival is at-most-once by default.
socket.emit('event1');
socket.emit('event2');
socket.emit('event3');
```

### Vitest Scoped Gate Commands

```bash
# Source: https://v1.vitest.dev/guide/cli
vitest run --config vitest.config.ts --dir packages
vitest run --config vitest.config.ts --dir tests/integration
```

## State of the Art

| Old Approach                                           | Current Approach                                                                    | When Changed          | Impact                                                                             |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------- | --------------------- | ---------------------------------------------------------------------------------- |
| Manual browser-only validation of gameplay loop        | Automated unit + Socket.IO integration suites (`vitest`)                            | Phases 1-4 groundwork | Enables repeatable regression checks for deterministic logic and runtime contracts |
| Monolithic "all tests" execution only                  | Split gate commands (`test:unit` and `test:integration`)                            | Current repo state    | Supports fast local loop plus full end-to-end validation                           |
| Implicit requirement coverage spread across many tests | Phase-5 target: explicit QUAL requirement mapping and one direct full-loop scenario | Phase 5 target        | Reduces ambiguity in requirement sign-off                                          |
| Teardown patterns vary by file                         | Phase-5 target: shared fixture/cleanup discipline for integration tests             | Phase 5 target        | Lowers flake risk and improves long-term repeatability                             |

**Deprecated/outdated:**

- Treating broad regression files as sufficient requirement traceability without explicit QUAL mapping.
- Relying on transient event arrival alone for reconnect-sensitive assertions.

## Open Questions

1. **Should Phase 5 add a dedicated `quality-gate-loop.test.ts` file?**
   - What we know: Existing tests already cover most of the flow, but coverage is distributed.
   - What's unclear: Whether distributed coverage is acceptable for explicit QUAL-02 sign-off.
   - Recommendation: Add one explicit requirement-tagged end-to-end scenario for unambiguous traceability.

2. **Should integration use `--no-file-parallelism` in CI/local gate mode?**
   - What we know: Vitest runs files in parallel by default; integration suite currently passes but is long-running.
   - What's unclear: Whether parallel execution causes intermittent flakes in constrained CI environments.
   - Recommendation: Keep current parallel mode by default; add a deterministic fallback script if flakiness appears.

3. **Should coverage thresholds be in scope for Phase 5?**
   - What we know: Requirements demand behavior coverage, not percentage thresholds; coverage provider is not installed.
   - What's unclear: Whether team wants hard minimums now.
   - Recommendation: Keep threshold enforcement optional unless explicitly requested by stakeholders.

## Sources

### Primary (HIGH confidence)

- `/home/alpine/crts-opencode/.planning/REQUIREMENTS.md` - QUAL-01 and QUAL-02 acceptance wording.
- `/home/alpine/crts-opencode/.planning/ROADMAP.md` - Phase 5 goal and success criteria.
- `/home/alpine/crts-opencode/.planning/STATE.md` - current project state and known concerns.
- `/home/alpine/crts-opencode/package.json` - current test commands and stack declarations.
- `npm ls vitest socket.io socket.io-client typescript vite --depth=0` - installed versions (`vitest@1.6.1`, `socket.io@4.8.3`, `socket.io-client@4.8.3`, `typescript@5.9.3`, `vite@5.4.21`).
- `/home/alpine/crts-opencode/vitest.config.ts` - test environment and include/exclude strategy.
- `/home/alpine/crts-opencode/packages/rts-engine/lobby.test.ts` - lobby/team invariant coverage.
- `/home/alpine/crts-opencode/packages/rts-engine/rts.test.ts` - queue validation, terminal outcomes, economy coverage.
- `/home/alpine/crts-opencode/tests/integration/server/match-lifecycle.test.ts` - breach/defeat lifecycle coverage.
- `/home/alpine/crts-opencode/tests/integration/server/server.test.ts` - join/build/state/outcome integration coverage.
- `/home/alpine/crts-opencode/packages/rts-engine/rts.ts` - authoritative queue/economy/outcome implementation.
- `/home/alpine/crts-opencode/apps/server/src/server.ts` - runtime tick loop and room-scoped outcome emissions.
- `https://v1.vitest.dev/guide/cli` - Vitest v1 CLI behavior and `--dir` support (version-aligned with project).
- `https://v1.vitest.dev/config/` - Vitest v1 config options (`fileParallelism`, timeouts, pool behavior).
- `https://v1.vitest.dev/guide/improving-performance` - isolation/parallelism tradeoffs for repeatability.
- `https://v1.vitest.dev/guide/coverage` - optional coverage-provider setup for threshold gating.
- `https://socket.io/docs/v4/testing/` (last updated Jan 22, 2026) - official testing patterns with real server/client sockets.
- `https://socket.io/docs/v4/delivery-guarantees/` (last updated Jan 22, 2026) - ordering and at-most-once delivery semantics.
- `https://socket.io/docs/v4/rooms/` (last updated Jan 22, 2026) - room-scoped broadcast behavior.
- `https://socket.io/docs/v4/typescript/` (last updated Jan 22, 2026) - typed server/client event contracts.

### Secondary (MEDIUM confidence)

- `npm run test:unit` (local run, 2026-03-01) - 50 passing unit tests, ~14.9s duration.
- `npm run test:integration` (local run, 2026-03-01) - 25 passing integration tests, ~89.9s duration.
- `npm test` (local run, 2026-03-01) - 78 passing total tests, ~90.5s duration.

### Tertiary (LOW confidence)

- None.

## Metadata

**Confidence breakdown:**

- Standard stack: HIGH - validated by installed package versions and active repository usage.
- Architecture: HIGH - directly evidenced by existing test/runtime code paths and current command structure.
- Pitfalls: MEDIUM - risks are evidence-backed but some (parallelism flake risk, threshold policy) depend on future CI conditions.

**Research date:** 2026-03-01
**Valid until:** 2026-03-31
