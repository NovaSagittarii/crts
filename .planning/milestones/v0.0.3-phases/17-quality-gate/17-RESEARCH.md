# Phase 17: Quality Gate - Research

**Researched:** 2026-03-29
**Domain:** Property-based testing, determinism verification, binary round-trip validation
**Confidence:** HIGH

## Summary

Phase 17 is a pure testing phase with no production code changes. It adds three categories of test coverage that serve as the final quality gate for the v0.0.3 lockstep protocol milestone: (1) property-based determinism tests using fast-check proving that identical input sequences produce identical state hashes across independent server (RtsRoom) and client (ClientSimulation) instances, (2) an ArrayBuffer round-trip integration test proving Grid.toPacked() survives the Socket.IO binary attachment path without corruption, and (3) verification that all pre-existing tests continue to pass.

The codebase already has extensive deterministic unit tests (QUAL-04 tests in rts.test.ts) and integration tests (quality-gate-loop.test.ts), but none use property-based testing. The project uses vitest 4.0.18 and has no fast-check dependency yet. The key insight is that the server-side RtsRoom and client-side ClientSimulation share the same deterministic engine code (RtsRoom.tick()), so the property-based test need only verify that: given identical starting state + identical input sequences, both produce identical determinism checkpoint hashes after N ticks.

**Primary recommendation:** Install fast-check as a dev dependency (not @fast-check/vitest -- the direct fc.assert/fc.property API is simpler and avoids an adapter layer). Write property-based tests as unit tests in packages/ or tests/web/ since the core determinism property is runtime-agnostic. Write the ArrayBuffer round-trip test as an integration test using the existing lockstep fixture infrastructure.

## Project Constraints (from CLAUDE.md)

- Strict TypeScript; avoid `any`
- Explicit `.js` extensions in relative imports
- Explicit return types for exported functions
- Interfaces for object shapes; type aliases for unions
- Deterministic unit tests for packages go in `packages/*`; cross-runtime tests go in `tests/integration/server/`; web view-model tests go in `tests/web/`
- Use fixture builders (`createIntegrationTest`, `createRoomTest`, `createMatchTest`, `createLockstepTest`) from existing test infrastructure
- Always use ephemeral ports (`port: 0`) for integration tests
- Keep `npm run lint` passing
- Conventional Commits for commit messages

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| QUAL-01 | Property-based determinism tests prove that identical input sequences produce identical state hashes across server and client simulation instances | fast-check fc.assert + fc.property with arbitraries for grid dimensions, alive cell positions, team count, build/destroy input sequences; run both RtsRoom and ClientSimulation from same payload, apply same inputs, advance same ticks, compare createDeterminismCheckpoint().hashHex |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| fast-check | 4.6.0 | Property-based test generation | The canonical PBT library for JS/TS; generates diverse random inputs, shrinks failures to minimal reproducible cases |
| vitest | 4.0.18 | Test runner (already installed) | Already the project test runner |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| @fast-check/vitest | 0.3.0 | Vitest-native test.prop integration | Optional -- provides test.prop() syntax sugar. NOT recommended for this phase because plain fc.assert works cleanly and avoids a new adapter |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| fast-check (direct) | @fast-check/vitest | Adapter adds syntactic sugar but another dependency and potential version coupling; fc.assert is sufficient |
| fast-check | Hypothesis (Python) | Wrong ecosystem; project is TypeScript |

**Installation:**
```bash
npm install --save-dev fast-check
```

**Version verification:** `npm view fast-check version` returns `4.6.0` (verified 2026-03-29). Compatible with Node 24.x and vitest 4.x.

## Architecture Patterns

### Test File Placement

The property-based determinism test exercises `RtsRoom` (from `#rts-engine`) and `ClientSimulation` (from `apps/web/src/`). Since `ClientSimulation` is in `apps/web/`, the test must live in `tests/web/` (same pattern as existing `client-simulation.test.ts`).

The ArrayBuffer round-trip test exercises the Socket.IO binary attachment path, so it belongs in `tests/integration/server/`.

The regression suite (existing tests pass) requires no new files -- just running `npm test`.

```
tests/
  web/
    client-simulation.test.ts          # existing
    determinism-property.test.ts       # NEW: property-based QUAL-01
  integration/
    server/
      arraybuffer-roundtrip.test.ts    # NEW: Grid.toPacked() through Socket.IO
```

### Pattern 1: Property-Based Determinism Test

**What:** Use fast-check to generate random but valid input sequences, then verify server and client simulation produce identical checkpoint hashes.

**When to use:** Proving determinism invariants hold across a wide space of inputs.

**Approach:**

```typescript
import fc from 'fast-check';
import { describe, it, expect } from 'vitest';
import { RtsRoom, createDefaultStructureTemplates } from '#rts-engine';
import { ClientSimulation } from '../../apps/web/src/client-simulation.js';

// Arbitrary: generate a valid build input relative to team base
const buildInputArb = (baseX: number, baseY: number) =>
  fc.record({
    templateId: fc.constant('block'),
    offsetX: fc.integer({ min: 4, max: 14 }),
    offsetY: fc.integer({ min: 4, max: 14 }),
    delayTicks: fc.integer({ min: 1, max: 10 }),
  }).map(({ templateId, offsetX, offsetY, delayTicks }) => ({
    templateId,
    x: baseX + offsetX,
    y: baseY + offsetY,
    delayTicks,
  }));

it('identical inputs produce identical hashes (QUAL-01)', () => {
  fc.assert(
    fc.property(
      fc.integer({ min: 0, max: 50 }),     // ticksBefore
      fc.integer({ min: 0, max: 5 }),      // number of build inputs
      fc.integer({ min: 10, max: 500 }),   // ticksAfter
      (ticksBefore, buildCount, ticksAfter) => {
        // 1. Create server room, add 2 players, tick ticksBefore
        // 2. Take snapshot payload
        // 3. Initialize ClientSimulation from payload
        // 4. Generate and apply buildCount builds to BOTH
        // 5. Advance both by ticksAfter ticks
        // 6. Compare determinism checkpoint hashes
        // returns true if hashes match
      }
    ),
    { numRuns: 200 } // 200 runs with diverse inputs; fast-check default is 100
  );
});
```

**Key design decisions:**
- Use `fc.assert` + `fc.property` directly (not @fast-check/vitest)
- Generate build placement offsets relative to team base to maximize acceptance rate
- Use `createDefaultStructureTemplates()` for all runs (consistent with real usage)
- Success criterion states "500+ ticks" -- use `fc.integer({ min: 500, max: 600 })` for the ticksAfter parameter in the main property
- Server room uses `RtsRoom.create()` + `room.addPlayer()` + `room.tick()` + `room.queueBuildEvent()`
- Client uses `ClientSimulation.initialize()` + `sim.applyQueuedBuild()` + `sim.advanceToTick()`

### Pattern 2: ArrayBuffer Round-Trip Integration Test

**What:** Verify Grid.toPacked() ArrayBuffer survives the Socket.IO wire (binary attachment encoding/decoding).

**When to use:** Testing that Socket.IO's binary serialization/deserialization preserves ArrayBuffer byte-level fidelity.

**Approach:**

```typescript
// In tests/integration/server/arraybuffer-roundtrip.test.ts
// Use existing lockstep test fixtures to create a match,
// receive the room:joined payload with state.grid (ArrayBuffer),
// then verify Grid.fromPacked(receivedGrid) produces identical cells
// to the server-side grid.
```

The existing integration test infrastructure already exercises this path implicitly (room:joined payload contains `state.grid` as an ArrayBuffer). The specific test should:
1. Create a match using `createLockstepTest` fixtures
2. Receive `room:joined` payload
3. Assert `payload.state.grid instanceof ArrayBuffer`
4. Unpack with `Grid.fromPacked(payload.state.grid, width, height)`
5. Compare cell-by-cell with server-side grid state

### Pattern 3: Regression Suite

**What:** Verify all pre-existing tests still pass.

**When to use:** After adding the new tests, run `npm test` to confirm no regressions.

**This requires no new code** -- just running the full test suite.

### Anti-Patterns to Avoid
- **Generating invalid room states directly:** Never construct RoomState by hand; always use `RtsRoom.create()` or `RtsRoom.fromPayload()` which set up runtime correctly
- **Using `any` casts in test code:** Even test files must satisfy the lint rules; use the same eslint-disable pattern as existing `client-simulation.test.ts` for cross-project type resolution
- **Running property tests with too few iterations:** 100+ runs is the minimum for meaningful coverage; the success criterion demands 500+ ticks per run, not 500+ runs
- **Ignoring build rejections in property tests:** Not all random build placements will be accepted; the test must handle `accepted: false` gracefully (skip the build, don't count it as a failure)

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Random test input generation | Custom Math.random() loops | fast-check arbitraries (fc.integer, fc.record, fc.array) | Shrinking, reproducibility, seed-based replay on failure |
| ArrayBuffer binary fidelity test | Manual Buffer manipulation | Grid.toPacked() + Grid.fromPacked() + Socket.IO integration fixture | The existing fixtures already handle server lifecycle and Socket.IO connection |
| Determinism hash comparison | Custom hash functions | RtsRoom.createDeterminismCheckpoint() / ClientSimulation.createLocalCheckpoint() | Already implemented with fnv1a-32; just compare hashHex values |
| Test fixture setup | Bespoke server/client lifecycle | createLockstepTest / createMatchTest from lockstep-fixtures.ts | Handles ephemeral ports, manual clock, cleanup |

**Key insight:** The entire determinism engine already exists and is well-tested. This phase only adds a new testing methodology (property-based) and a specific binary path validation. No production code changes are needed.

## Common Pitfalls

### Pitfall 1: Build Placement Failures in Property Tests
**What goes wrong:** Random coordinates cause build:queue rejections (outside-territory, occupied-site, insufficient-resources), making the test think determinism failed.
**Why it happens:** The build placement system has strict spatial constraints relative to team base and build zones.
**How to avoid:** Generate build coordinates as offsets from team.baseTopLeft within known valid ranges (offset 4-14 from base, which is within territory radius of 12). Handle rejection gracefully -- if server rejects, don't replay on client.
**Warning signs:** Property test fails on "builds not matching" rather than hash mismatch.

### Pitfall 2: ClientSimulation Needs Templates from createDefaultStructureTemplates()
**What goes wrong:** ClientSimulation.initialize() is called without the block/generator templates, causing builds to silently fail.
**Why it happens:** RtsRoom.fromPayload() auto-injects the core template but not block/generator templates.
**How to avoid:** Always pass `createDefaultStructureTemplates()` to ClientSimulation.initialize(), matching the pattern in the existing client-simulation.test.ts.
**Warning signs:** Client simulation diverges from server after first build application.

### Pitfall 3: Resource Cost Deduction Mismatch
**What goes wrong:** ClientSimulation.applyQueuedBuild() deducts reservedCost from team.resources, but if the test doesn't populate reservedCost correctly, the economy diverges.
**Why it happens:** The client gets reservedCost from the template's activationCost via `template?.activationCost ?? 0`.
**How to avoid:** When generating build payloads for the property test, use the same template that the server uses, and let the engine compute the cost. Use `room.queueBuildEvent()` on the server and construct the matching `BuildQueuedPayload` for the client from the server's returned eventId/executeTick.
**Warning signs:** Hash divergence appears only when using non-zero-cost templates (generator).

### Pitfall 4: Tick Synchronization Between Server and Client
**What goes wrong:** Server is at tick N but client thinks it's at a different tick, causing hash comparison at the wrong state.
**Why it happens:** Server's room.tick() advances room.state.tick by 1 each call. Client's advanceToTick(N) must be called with exactly the right target.
**How to avoid:** After all inputs are applied, advance both to the same target tick, then compare checkpoints. Use `room.state.tick` as the authoritative tick count.
**Warning signs:** Hashes match sometimes but not others; depends on random input count.

### Pitfall 5: ESLint Cross-Project Type Resolution
**What goes wrong:** ESLint fails on imports from `../../apps/web/src/client-simulation.js` because it's outside tsconfig include boundary.
**Why it happens:** The test file in `tests/web/` imports from `apps/web/`, which is a different TypeScript project root.
**How to avoid:** Add the same eslint-disable comments as the existing `client-simulation.test.ts`:
```typescript
/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
```
**Warning signs:** `npm run lint` fails with type-checking errors on the new test file.

### Pitfall 6: ArrayBuffer Comparison Semantics
**What goes wrong:** `expect(receivedGrid).toEqual(originalGrid)` fails even though bytes are identical because ArrayBuffer equality is reference-based.
**Why it happens:** JavaScript ArrayBuffer objects don't have value-equality semantics.
**How to avoid:** Compare via `new Uint8Array(receivedGrid)` vs `new Uint8Array(originalGrid)`, or compare unpacked Grid cell states.
**Warning signs:** Test fails on identical data with "not equal" on ArrayBuffer objects.

## Code Examples

### Creating Server Room with 2 Players (verified pattern from rts.test.ts)
```typescript
// Source: packages/rts-engine/rts.test.ts, tests/web/client-simulation.test.ts
const room = RtsRoom.create({
  id: 'prop-room',
  name: 'Property Test',
  width: 80,
  height: 80,
});
const team1 = room.addPlayer('player-1', 'Player 1');
const team2 = room.addPlayer('player-2', 'Player 2');
const templates = createDefaultStructureTemplates();
```

### Initializing ClientSimulation from Server State (verified pattern from client-simulation.test.ts)
```typescript
// Source: tests/web/client-simulation.test.ts
const payload = room.createStatePayload();
const sim = new ClientSimulation();
sim.initialize(payload, templates);
```

### Queuing Build on Server and Replaying on Client
```typescript
// Source: tests/web/client-simulation.test.ts lines 374-406
const buildResult = room.queueBuildEvent('player-1', {
  templateId: 'block',
  x: team1.baseTopLeft.x + 8,
  y: team1.baseTopLeft.y + 8,
  delayTicks: 4,
});

if (buildResult.accepted) {
  // Build the matching client payload
  const buildPayload: BuildQueuedPayload = {
    roomId: room.id,
    intentId: `intent-${buildResult.eventId}`,
    playerId: 'player-1',
    teamId: team1.id,
    bufferedTurn: 0,
    scheduledByTurn: 0,
    templateId: 'block',
    x: team1.baseTopLeft.x + 8,
    y: team1.baseTopLeft.y + 8,
    transform: { operations: [], matrix: { xx: 1, xy: 0, yx: 0, yy: 1 } },
    delayTicks: 4,
    eventId: buildResult.eventId!,
    executeTick: buildResult.executeTick!,
    sequence: 0,
  };
  sim.applyQueuedBuild(buildPayload);
}
```

### Comparing Determinism Checkpoints
```typescript
// Source: packages/rts-engine/rts.test.ts line 1351-1353
const serverCheckpoint = room.createDeterminismCheckpoint();
const clientCheckpoint = sim.createLocalCheckpoint();
expect(clientCheckpoint!.hashHex).toBe(serverCheckpoint.hashHex);
```

### fast-check Property Pattern (canonical pattern from fast-check docs)
```typescript
import fc from 'fast-check';

fc.assert(
  fc.property(
    fc.integer({ min: 1, max: 100 }),
    fc.array(fc.integer({ min: 0, max: 79 }), { minLength: 0, maxLength: 10 }),
    (tickCount, buildOffsets) => {
      // ... setup and verify property ...
      return serverHash === clientHash;
    }
  ),
  { numRuns: 200 }
);
```

### Grid.toPacked() Round-Trip (verified pattern from grid.test.ts)
```typescript
// Source: packages/conway-core/grid.test.ts lines 241-253
const grid = new Grid(11, 7, [
  { x: 0, y: 0 },
  { x: 10, y: 0 },
  { x: 4, y: 2 },
]);
const packed = grid.toPacked();
const unpacked = Grid.fromPacked(packed, 11, 7);
expect([...unpacked.cells()]).toEqual([...grid.cells()]);
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Example-based determinism tests | Property-based determinism tests | This phase | Wider coverage, automatic edge case discovery, failure shrinking |
| Implicit binary fidelity (trusted) | Explicit ArrayBuffer round-trip test | This phase | Validates binary attachment path end-to-end |

**No deprecated APIs involved:** All APIs used (RtsRoom, ClientSimulation, Grid, fast-check) are current and stable.

## Open Questions

1. **Destroy input generation strategy**
   - What we know: Build inputs need spatial coordinates relative to team base; destroy inputs need a valid structureKey from an existing built structure.
   - What's unclear: Whether property tests should include destroy inputs or focus only on builds (builds are the more complex path).
   - Recommendation: Include destroy inputs in at least one property to cover the full input space. Generate a destroy only after a build has been applied (at least delayTicks ticks after queueing).

2. **Performance of 500+ tick property tests at 200 runs**
   - What we know: Each tick runs Conway's Game of Life step on an 80x80 grid (6400 cells) plus RTS logic. 500 ticks x 200 runs = 100,000 tick operations.
   - What's unclear: Whether this completes in a reasonable time (<30s) for the test suite.
   - Recommendation: Start with 200 runs at 500 ticks on an 80x80 grid. If too slow, reduce grid to 52x52 (matching integration test sizes) or reduce numRuns. Pure computation (no I/O) should be fast.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | Runtime | Yes | 24.13.0 | -- |
| npm | Package install | Yes | 11.9.0 | -- |
| vitest | Test runner | Yes | 4.0.18 | -- |
| fast-check | Property-based tests | No (not yet installed) | 4.6.0 (registry) | Must install |
| Socket.IO | Integration test binary path | Yes | ^4.7.5 | -- |

**Missing dependencies with no fallback:**
- fast-check must be installed: `npm install --save-dev fast-check`

**Missing dependencies with fallback:**
- None

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 4.0.18 |
| Config file | vitest.config.ts |
| Quick run command | `npx vitest run tests/web/determinism-property.test.ts` |
| Full suite command | `npm test` |

### Phase Requirements to Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| QUAL-01 | Identical input sequences produce identical state hashes across server and client | unit (property-based) | `npx vitest run tests/web/determinism-property.test.ts` | No -- Wave 0 |
| QUAL-01 (binary) | Grid.toPacked() ArrayBuffer survives Socket.IO binary attachment | integration | `npx vitest run tests/integration/server/arraybuffer-roundtrip.test.ts` | No -- Wave 0 |
| QUAL-01 (regression) | All pre-existing tests continue to pass | full suite | `npm test` | Yes (existing) |

### Sampling Rate
- **Per task commit:** `npx vitest run tests/web/determinism-property.test.ts` or `npx vitest run tests/integration/server/arraybuffer-roundtrip.test.ts`
- **Per wave merge:** `npm run test:fast && npm run test:integration:light`
- **Phase gate:** Full suite green via `npm test`

### Wave 0 Gaps
- [ ] `tests/web/determinism-property.test.ts` -- covers QUAL-01 property-based determinism
- [ ] `tests/integration/server/arraybuffer-roundtrip.test.ts` -- covers QUAL-01 binary round-trip
- [ ] Install fast-check: `npm install --save-dev fast-check`

## Sources

### Primary (HIGH confidence)
- Project codebase: `packages/rts-engine/rts.ts` -- RtsRoom, RtsEngine, createDeterminismCheckpoint, fromPayload, tickRoom
- Project codebase: `apps/web/src/client-simulation.ts` -- ClientSimulation class with initialize, advanceToTick, applyQueuedBuild, createLocalCheckpoint
- Project codebase: `packages/conway-core/grid.ts` -- Grid.toPacked(), Grid.fromPacked()
- Project codebase: `tests/web/client-simulation.test.ts` -- existing test patterns for ClientSimulation
- Project codebase: `packages/rts-engine/rts.test.ts` -- existing determinism tests (QUAL-04)
- npm registry: fast-check 4.6.0, @fast-check/vitest 0.3.0

### Secondary (MEDIUM confidence)
- [fast-check official docs](https://fast-check.dev/) -- API reference for fc.assert, fc.property, arbitraries
- [fast-check GitHub](https://github.com/dubzzz/fast-check) -- source and examples
- [@fast-check/vitest npm](https://www.npmjs.com/package/@fast-check/vitest) -- vitest 4.x compatibility info
- [Socket.IO testing docs](https://socket.io/docs/v4/testing/) -- binary attachment handling

### Tertiary (LOW confidence)
- None

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- fast-check 4.6.0 is the canonical PBT library for TypeScript; verified in npm registry
- Architecture: HIGH -- test placement follows established project patterns; all APIs are already in use in existing tests
- Pitfalls: HIGH -- identified from direct code reading of ClientSimulation, RtsRoom.fromPayload, and existing test patterns

**Research date:** 2026-03-29
**Valid until:** 2026-04-28 (30 days -- stable domain, no fast-moving dependencies)
