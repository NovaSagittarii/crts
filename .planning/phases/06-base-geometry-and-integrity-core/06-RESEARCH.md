# Phase 6: Base Geometry and Integrity Core - Research

**Researched:** 2026-03-02
**Domain:** Deterministic base geometry and structure-integrity resolution in a tick-driven TypeScript RTS engine
**Confidence:** HIGH

<user_constraints>

## User Constraints (from CONTEXT.md)

### Locked Decisions

#### Base footprint and breach evaluation

- Base anchor remains `team.baseTopLeft` and denotes the top-left of a `5x5` base bounding box.
- Canonical occupied base cells are the four corner `2x2` blocks in that `5x5` box.
- In local base coordinates `(x, y)` from `(0..4, 0..4)`, occupied cells are where `x in {0,1,3,4}` and `y in {0,1,3,4}` (16 cells total).
- Breach checks evaluate only the canonical 16 occupied cells; the center cross is not directly checked.
- Breach pressure scales linearly with the number of compromised canonical cells.

#### Base integrity restoration and `baseIntact` semantics

- `baseIntact` remains authoritative and is true when core HP is above 0.
- When canonical base integrity fails and core HP remains above 0, integrity is auto-restored during the same check processing.
- Base restore cost is `1 HP` per canonical cell that must be flipped back to canonical state.
- Restoration and resulting HP updates must be deterministic across identical runs.

#### Base center, territory, and spawn spacing

- Canonical base center is `(baseTopLeft.x + 2, baseTopLeft.y + 2)`.
- Territory placement validation and territory cell counting use this center anchor.
- Spawn layout and overlap checks continue using base footprint dimensions `5x5`.
- Spawn minimum wrapped distance is geometry-derived as `3 * baseWidth` (`15` for the `5x5` footprint in this phase).
- If ideal spawn points fail constraints, fallback selection uses deterministic seeded randomness so identical seeds produce identical outcomes.

#### Integrity cadence and structure HP outcomes

- Breach/integrity restore checks run on one shared configurable interval `N` simulation ticks (not hardcoded every tick).
- `N` must be defined in shared gameplay rules/config consumed consistently by engine, server, and deterministic tests.
- Every placed player-owned template is integrity-tracked in Phase 6.
- Integrity masks default to all live template cells, so templates without explicit `checks` still participate.
- Integrity evaluation order is deterministic: team ID ascending, then stable structure ordering.
- Integrity and HP writes occur only in one authoritative tick phase; queue/preview paths remain read-only.
- Failed integrity checks charge the full restoration cost; if that cost exceeds current HP, apply full cost (HP may go negative), destroy the structure, and leave a debris-state footprint.
- Initial HP constants remain locked to: core `3`, non-core integrity-tracked structures `2`.

#### Defeat and destruction semantics under `5x5` rules

- Team defeat is triggered only by core HP less than or equal to 0.
- Core damage follows the same full restoration-cost accounting and may underflow before defeat resolution.
- On core destruction, the team is marked defeated once, pending queued builds drain deterministically with `team-defeated`, and canonical outcome ranking remains stable.
- Destroyed structures do not rewrite the underlying Conway grid; only structure-specific properties and effects are removed.
- Integrity outcomes must be emitted in deterministic stable order with explicit outcome categories: `repaired`, `destroyed-debris`, and `core-defeat`.

### OpenCode's Discretion

- Exact helper/module names for geometry and integrity extraction.
- Config key naming and default value for the shared integrity interval `N`.
- Exact timeline/event metadata shape for per-structure integrity outcomes.
- Internal representation and caching strategy for debris-state structures and integrity masks, as long as deterministic behavior is preserved.

### Deferred Ideas (OUT OF SCOPE)

- Union build-zone legality and fixed radius 15 behavior (`BUILD-01`, `BUILD-02`) are deferred to Phase 7.
- Rotate/mirror placement consistency (`XFORM-01`, `XFORM-02`, `QUAL-03`) is deferred to Phase 8.
- Destroy command outcomes and reconnect determinism expansion (`STRUCT-02`, `QUAL-04`) are deferred to Phase 9.
- Match-screen split, camera/build-zone visualization, and hover/overlay interaction surfaces are deferred to Phases 10-12.
- Add map-size vs max-player limits as a dedicated future phase so spawn feasibility constraints are explicit per map.

</user_constraints>

<phase_requirements>

## Phase Requirements

| ID        | Description                                                                                                                                              | Research Support                                                                                                                                                                                                                                                                                  |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| BASE-01   | Match starts with a canonical 5x5 base footprint composed of four 2x2 blocks (16 total base cells) that is used consistently for breach gameplay.        | Standardizes a shared geometry helper + canonical occupancy predicate, updates territory center/spawn/breach math to `5x5` and `+2`, and adds explicit fixture rules to prevent legacy `2x2` assumptions.                                                                                         |
| STRUCT-01 | Player-owned structures run template-wide integrity checks every K ticks, and failed checks consume structure HP to restore integrity deterministically. | Defines one authoritative integrity phase keyed off shared tick cadence `N`, template-wide masks (including templates without explicit `checks`), deterministic ordering, full restoration-cost accounting, and deterministic outcome categories (`repaired`, `destroyed-debris`, `core-defeat`). |

</phase_requirements>

## Summary

Phase 6 should be implemented as a strict deterministic simulation upgrade inside `packages/rts-engine`, not as a runtime/UI change. The current engine is still hardcoded to a contiguous `2x2` base (`BASE_BLOCK_WIDTH/HEIGHT = 2`), uses `baseTopLeft + 1` center math, and resolves integrity only for the core (`CORE_RESTORE_INTERVAL_TICKS = 1` and fixed `-1` HP). That baseline must be replaced with canonical `5x5` corner-block geometry and template-wide integrity accounting.

For this phase, the critical architecture is: one shared geometry model, one shared gameplay-rules config for cadence/constants, and one authoritative integrity phase in the tick pipeline with explicit deterministic ordering. Keep queue/preview read-only and perform all integrity/HP writes in exactly one post-step simulation phase. This aligns with existing package boundaries and preserves server-authoritative behavior.

SOTA correction versus stale assumptions: Socket.IO still guarantees ordering, but delivery is at-most-once by default and missed events are not automatically replayed for disconnected clients unless you build that behavior (or use optional connection state recovery, added in 4.6.0, which is not always successful). For integrity semantics, authoritative state projection (`state` + `baseIntact`) must remain the source of truth.

**Primary recommendation:** Implement a dedicated `5x5` base-geometry helper plus a shared `gameplay-rules` module, then route all integrity/HP resolution through a deterministic, single-phase tick resolver that computes full restoration cost per mismatched canonical/integrity cell.

## Standard Stack

### Core

| Library                | Version | Purpose                                                                         | Why Standard                                                                                                  |
| ---------------------- | ------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| In-repo `#rts-engine`  | current | Authoritative room/team/structure simulation and deterministic tick transitions | Existing architecture already centralizes gameplay logic here; Phase 6 is a direct extension of this package. |
| In-repo `#conway-core` | current | Deterministic Conway grid stepping and cell apply/update primitives             | Phase 6 integrity must remain deterministic relative to authoritative Conway evolution.                       |
| `typescript`           | 5.9.3   | Strict typing across runtime and deterministic package logic                    | Prevents contract drift while refactoring geometry/integrity state paths.                                     |
| `vitest`               | 1.6.1   | Deterministic unit + integration verification                                   | Existing project standard for validating tick-order and outcome determinism.                                  |

### Supporting

| Library            | Version      | Purpose                                           | When to Use                                                                                             |
| ------------------ | ------------ | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `socket.io`        | 4.8.3        | Runtime event transport                           | Use for server-client propagation of authoritative outcomes; not for simulation authority.              |
| `socket.io-client` | 4.8.3        | Integration harness and reconnect behavior checks | Use in integration tests to verify deterministic outward behavior under reconnect/disconnect scenarios. |
| Node.js Timers API | Node runtime | Server tick scheduling (`setInterval`)            | Use only to trigger ticks; never as deterministic simulation truth source.                              |

### Alternatives Considered

| Instead of                           | Could Use                                        | Tradeoff                                                                                   |
| ------------------------------------ | ------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| Shared `5x5` geometry helper         | Inline coordinate math in each callsite          | Fast to start, but creates geometry drift (`+1`/`+2`, `2x2`/`5x5`) and future regressions. |
| Tick-index cadence (`room.tick % N`) | Wall-clock cadence via `Date.now()`/timer deltas | Wall-clock timing is non-deterministic under load; breaks identical-run guarantees.        |
| Explicit sorted integrity traversal  | Implicit `Map` iteration order only              | Works until mutation patterns change; explicit ordering is safer and requirement-aligned.  |

**Installation:**

```bash
npm install
```

## Architecture Patterns

### Recommended Project Structure

```text
packages/rts-engine/
├── geometry.ts                 # canonical 5x5 base footprint and center helpers
├── gameplay-rules.ts           # shared constants (integrity cadence N, base dims, HP defaults)
├── rts.ts                      # authoritative tick pipeline and integrity resolution phase
├── match-lifecycle.ts          # stable defeat/outcome comparator and ranking
├── rts.test.ts                 # deterministic unit coverage for BASE-01 + STRUCT-01
└── spawn.test.ts               # spawn spacing and deterministic fallback checks

apps/server/src/server.ts       # runtime tick scheduler only (no duplicated gameplay constants)
tests/integration/server/*.test.ts  # cross-client deterministic behavior checks
```

### Pattern 1: Canonical Footprint as a Single Source of Truth

**What:** Encode the `5x5` base occupancy mask and center math in one shared helper used by seed, breach, territory, and spawn calculations.
**When to use:** Any logic that reads/writes/validates base cells or base-relative coordinates.
**Example:**

```typescript
// Source: .planning/phases/06-base-geometry-and-integrity-core/06-CONTEXT.md
export const BASE_WIDTH = 5;
export const BASE_HEIGHT = 5;

export function isCanonicalBaseCell(localX: number, localY: number): boolean {
  const edgeBand = localX === 0 || localX === 1 || localX === 3 || localX === 4;
  const edgeRow = localY === 0 || localY === 1 || localY === 3 || localY === 4;
  return edgeBand && edgeRow;
}

export function baseCenter(baseTopLeft: { x: number; y: number }): {
  x: number;
  y: number;
} {
  return { x: baseTopLeft.x + 2, y: baseTopLeft.y + 2 };
}
```

### Pattern 2: One Authoritative Integrity Phase per Tick

**What:** Resolve all integrity checks and HP writes in one deterministic post-step phase.
**When to use:** Every active simulation tick after Conway step and before defeat/outcome resolution.
**Example:**

```typescript
// Source: packages/rts-engine/rts.ts (tick order baseline)
room.grid = stepGrid(room.grid, room.width, room.height);
room.tick += 1;
room.generation += 1;

const integrityOutcomes = resolveIntegrityChecks(room); // new generalized phase
const defeatedTeams = resolveDefeats(room, integrityOutcomes);
```

### Pattern 3: Deterministic Traversal with Explicit Comparator

**What:** Sort participating entities explicitly (team id asc, then stable structure key) before applying integrity effects.
**When to use:** Any multi-entity mutation pass where order affects results or emitted outcomes.
**Example:**

```typescript
// Source: MDN Array.sort stability + project comparator patterns
const teams = [...room.teams.values()].sort((a, b) => a.id - b.id);
for (const team of teams) {
  const structures = [...team.structures.values()].sort((a, b) =>
    a.key.localeCompare(b.key),
  );
  for (const structure of structures) {
    resolveStructureIntegrity(room, team, structure);
  }
}
```

### Pattern 4: Tick-Based Cadence from Shared Rules

**What:** Gate integrity checks by integer tick modulo against a shared config constant.
**When to use:** Integrity cadence, and any future deterministic periodic mechanic.
**Example:**

```typescript
// Source: packages/rts-engine/rts.ts (current core-only modulo gate)
if (
  INTEGRITY_CHECK_INTERVAL_TICKS > 0 &&
  room.tick % INTEGRITY_CHECK_INTERVAL_TICKS === 0
) {
  resolveIntegrityChecks(room);
}
```

### Anti-Patterns to Avoid

- **Scattered geometry math:** hardcoded `+1`/`2x2` assumptions in multiple callsites cause silent rule drift.
- **Integrity writes outside tick phase:** mutating HP/cells from preview/queue paths breaks authority and determinism.
- **Clamping away underflow semantics:** premature `Math.max(0, hp - cost)` conflicts with locked full-cost accounting requirements.
- **Implicit ordering dependence:** relying only on insertion order instead of explicit comparators obscures deterministic guarantees.
- **Using `Math.random()` for spawn fallback:** seed cannot be chosen/reset by user, so runs are not reproducible from seed intent.

## Don't Hand-Roll

| Problem                         | Don't Build                                | Use Instead                                                                                                    | Why                                                                                                     |
| ------------------------------- | ------------------------------------------ | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Base geometry semantics         | Ad-hoc `if`/offset checks at each callsite | Shared `geometry.ts` canonical footprint helpers                                                               | Prevents mismatched interpretations between seeding, breach, territory, and spawn logic.                |
| Integrity cadence and constants | Duplicated literals in engine/server/tests | Shared gameplay-rules module consumed by all layers                                                            | Eliminates drift in `N`, base size, HP defaults, and spawn spacing rules.                               |
| Deterministic random fallback   | Direct `Math.random()` usage               | Existing seeded utilities in `spawn.ts` (`seededUnit`, `nextSpawnOrientationSeed`) or shared seeded RNG helper | `Math.random()` seed cannot be user-controlled/reset; deterministic fallback requires explicit seeding. |
| Event replay/reconnect recovery | Custom one-off event replay assumptions    | Authoritative `state` snapshots plus documented Socket.IO recovery behavior                                    | Socket.IO default is at-most-once; missed events are not replayed by default.                           |
| Ordering guarantees             | Unspecified iteration side effects         | Explicit comparator-based sorting (`teamId`, `structure key`, `eventId`)                                       | Makes deterministic order auditable and resilient to internal representation changes.                   |

**Key insight:** Most Phase 6 risk is not algorithmic complexity; it is semantic drift from duplicated constants/order assumptions across engine, server, tests, and payload projection.

## Common Pitfalls

### Pitfall 1: Legacy `2x2` Assumptions Leaking into `5x5` Rules

**What goes wrong:** Breach, territory, or spawn logic still behaves as if base footprint is contiguous `2x2`.
**Why it happens:** Existing code uses `BASE_BLOCK_WIDTH/HEIGHT = 2` and center `baseTopLeft + 1` in multiple places.
**How to avoid:** Route all base-relative calculations through canonical helper functions and replace direct offsets.
**Warning signs:** Tests still reference only four base cells; spawn minimum distance remains `baseWidth + 1`.

### Pitfall 2: Empty `checks` Templates Accidentally Skipped

**What goes wrong:** Non-core structures with no explicit `checks` are never integrity-tracked.
**Why it happens:** Current `checkStructureIntegrity` returns `false` when `template.checks.length === 0`.
**How to avoid:** Build integrity masks from all live template cells when `checks` are absent.
**Warning signs:** Structures with empty checks never trigger repair/destroy outcomes despite cell corruption.

### Pitfall 3: Cadence Config Not Truly Shared

**What goes wrong:** Engine, server, and tests evaluate integrity at different frequencies.
**Why it happens:** Cadence remains a local constant (`CORE_RESTORE_INTERVAL_TICKS`) instead of shared rules module.
**How to avoid:** Define one exported `INTEGRITY_CHECK_INTERVAL_TICKS` and import it everywhere.
**Warning signs:** Unit tests pass but integration assertions fail by one or more ticks.

### Pitfall 4: Non-Deterministic Mutation Order

**What goes wrong:** Identical runs produce different repair/destroy order and payload ordering.
**Why it happens:** Traversal order relies on incidental insertion history instead of explicit comparator.
**How to avoid:** Sort teams/structures/outcomes by deterministic keys before applying or emitting effects.
**Warning signs:** Flaky ordering assertions in `buildOutcomes`, timeline events, or match ranking tie-breakers.

### Pitfall 5: Trusting Transport Events as Durable Truth

**What goes wrong:** Reconnected clients miss integrity outcomes and derive stale local interpretation.
**Why it happens:** Socket.IO events are ordered but at-most-once by default; server does not buffer missed events automatically.
**How to avoid:** Treat `state` payload snapshots (`baseIntact`, structure HP/state) as canonical and idempotent.
**Warning signs:** Reconnect tests only assert event receipt and do not assert eventual authoritative state convergence.

## Code Examples

Verified patterns from project code and official docs:

### Authoritative Tick Pipeline Before/After Integrity

```typescript
// Source: packages/rts-engine/rts.ts
for (const team of room.teams.values()) {
  applyTeamEconomyAndQueue(room, team, acceptedEvents, buildOutcomes);
}

room.grid = stepGrid(room.grid, room.width, room.height);
room.tick += 1;
room.generation += 1;

const coreHpBeforeResolution = resolveCoreRestoreChecks(room); // phase-generalize here
```

### Stable Event Ordering Comparator

```typescript
// Source: packages/rts-engine/rts.ts
function compareBuildEvents(a: BuildEvent, b: BuildEvent): number {
  return a.executeTick - b.executeTick || a.id - b.id;
}
```

### Socket.IO Delivery Guarantee Boundary

```typescript
// Source: https://socket.io/docs/v4/delivery-guarantees/
// Ordering is guaranteed, but arrival is at-most-once by default.
socket.emit('event1');
socket.emit('event2');
socket.emit('event3');
```

### Deterministic Timer Testing in Vitest

```typescript
// Source: https://v1.vitest.dev/api/vi.html#vi-usefaketimers
vi.useFakeTimers();
setInterval(onTick, 100);
vi.advanceTimersByTime(300);
expect(onTick).toHaveBeenCalledTimes(3);
```

## State of the Art

| Old Approach                                                       | Current Approach                                                                     | When Changed                                 | Impact                                                                                         |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------ | -------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Contiguous `2x2` base with center `+1`                             | Canonical `5x5` corner-block base with center `+2`                                   | Phase 6 locked context (2026-03-01)          | Unifies breach, territory, spawn, and payload semantics around one geometry contract.          |
| Core-only integrity (`CORE_RESTORE_INTERVAL_TICKS`, fixed `-1` HP) | Template-wide integrity with shared cadence `N` and full restoration-cost accounting | Phase 6 requirement lock (`STRUCT-01`)       | Enables deterministic non-core repair/destroy outcomes and removes hidden core special-casing. |
| Implicit reconnect expectations from event stream                  | Explicit authoritative state convergence; optional recovery feature with caveats     | Socket.IO 4.6.0+ (`connectionStateRecovery`) | Prevents reconnect desync assumptions; planner should design state-first verification.         |
| Assumed runtime sort behavior sufficient without constraints       | Stable sort is standardized (ES2019+), but comparator correctness remains mandatory  | ECMAScript 2019+ (documented by MDN)         | Supports explicit deterministic ordering strategy with auditable comparators.                  |

**Deprecated/outdated:**

- Using `Math.random()` for deterministic spawn fallback logic.
- Encoding base/integrity semantics in comments/tests only, without a shared geometry/rules module.
- Treating transport event arrival as durable state truth for reconnect-sensitive behavior.

## Open Questions

1. **What exact key should be used for stable structure ordering in integrity resolution?**
   - What we know: Requirement demands deterministic team-id + stable structure order.
   - What's unclear: Whether `structure.key` string sort is sufficient or a tuple (`y,x,templateId`) should be canonicalized.
   - Recommendation: Use `structure.key` if format is immutable and explicitly documented; otherwise define explicit tuple comparator in code.

2. **What default value should shared integrity cadence `N` use?**
   - What we know: Must be configurable and shared across engine/server/tests.
   - What's unclear: Whether product pacing wants immediate migration parity (`N=1`) or slower cadence for balance.
   - Recommendation: Set default `N=1` for Phase 6 to preserve current pacing, then tune in later balance phases.

3. **How should debris-state footprint be represented for destroyed non-core structures?**
   - What we know: Destroyed structures must leave Conway cells untouched but clear structure-specific effects.
   - What's unclear: Whether to keep a `destroyed` flag in `StructureInstance` or move to a separate debris registry.
   - Recommendation: Keep state in `StructureInstance` first (lowest migration cost), with explicit `active/buildRadius/hp` semantics and deterministic serialization order.

## Sources

### Primary (HIGH confidence)

- `/home/alpine/crts-opencode/.planning/REQUIREMENTS.md` - Requirement text for `BASE-01` and `STRUCT-01`.
- `/home/alpine/crts-opencode/.planning/phases/06-base-geometry-and-integrity-core/06-CONTEXT.md` - Locked implementation decisions and out-of-scope boundaries.
- `/home/alpine/crts-opencode/.planning/STATE.md` - Current phase status and architecture constraints.
- `/home/alpine/crts-opencode/.planning/ROADMAP.md` - Phase success criteria and sequencing.
- `/home/alpine/crts-opencode/packages/rts-engine/rts.ts` - Current geometry/integrity baseline and tick order.
- `/home/alpine/crts-opencode/packages/rts-engine/spawn.ts` - Deterministic spawn and seeded fallback primitives.
- `/home/alpine/crts-opencode/packages/rts-engine/match-lifecycle.ts` - Deterministic ranking comparator behavior.
- `/home/alpine/crts-opencode/packages/rts-engine/rts.test.ts` - Unit coverage assumptions currently tied to `2x2` behavior.
- `/home/alpine/crts-opencode/tests/integration/server/server.test.ts` - Integration fixture patterns that currently assume legacy base offsets.
- `/home/alpine/crts-opencode/tests/integration/server/quality-gate-loop.test.ts` - End-to-end queue/breach/defeat flow constraints.
- `/home/alpine/crts-opencode/package.json` and `npm ls vitest typescript socket.io socket.io-client vite --depth=0` - Installed toolchain/runtime versions.
- `https://nodejs.org/api/timers.html` (Node v25 docs) - Timer behavior and non-exact callback timing guarantees.
- `https://socket.io/docs/v4/delivery-guarantees/` (last updated Jan 22, 2026) - Ordered delivery + at-most-once default semantics.
- `https://socket.io/docs/v4/connection-state-recovery` (last updated Jan 22, 2026) - Recovery feature scope/caveats and version intro.
- `https://socket.io/docs/v4/changelog/4.8.3` (last updated Feb 4, 2026) - Current 4.8.3 status.
- `https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Math/random` (last modified Jul 10, 2025) - seed/reset limitation.
- `https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Map` (last modified Feb 16, 2026) - insertion-order iteration semantics.
- `https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/sort` (last modified Jul 20, 2025) - stable sort guarantee and comparator constraints.
- `https://v1.vitest.dev/api/vi.html#vi-usefaketimers` - fake timer APIs for deterministic cadence tests.

### Secondary (MEDIUM confidence)

- `npx vitest run packages/rts-engine/rts.test.ts packages/rts-engine/spawn.test.ts` (2026-03-02) - Baseline deterministic tests pass (25 tests).

### Tertiary (LOW confidence)

- `https://gafferongames.com/post/fix_your_timestep/` - foundational fixed-timestep rationale (conceptual, dated 2004).
- `https://gafferongames.com/post/deterministic_lockstep/` - deterministic lockstep principles (conceptual, dated 2014).

## Metadata

**Confidence breakdown:**

- Standard stack: HIGH - backed by installed versions, current repo usage, and official docs.
- Architecture: HIGH - derived from locked context decisions and direct code-path inspection.
- Pitfalls: HIGH - confirmed by existing implementation hotspots plus official transport/timer semantics.

**Research date:** 2026-03-02
**Valid until:** 2026-04-01
