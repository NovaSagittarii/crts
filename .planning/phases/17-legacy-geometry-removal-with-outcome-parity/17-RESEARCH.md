# Phase 17: Legacy Geometry Removal with Outcome Parity - Research

**Researched:** 2026-03-03
**Domain:** Authoritative geometry cleanup in `packages/rts-engine/rts.ts` with outcome parity guarantees
**Confidence:** HIGH

<user_constraints>

## User Constraints (from CONTEXT.md)

### Locked Decisions

#### Parity scenario set

- Must-pass suite uses a core + edge-case mix rather than only happy paths or a near-exhaustive matrix.
- Representative flows must cover all orientation/transform variants used in those flows.
- Scenarios must include both build success paths and invalid/reject paths.
- Any single representative mismatch blocks Phase 17 sign-off.

#### Invalid-action equivalence

- Equivalent invalid attempts must preserve outcome + rejection reason parity.
- Client-facing rejection text can vary as long as semantics and reason taxonomy are equivalent.
- Repeated invalid attempts must preserve rejection cadence in the action timeline.
- Invalid attempts must cause no side-effect drift.

#### Deterministic state matching

- Deterministic reruns must match both final state and required intermediate checkpoints.
- Checkpoints are compared after each action boundary.
- Resource parity requires exact per-player totals at required comparison points.
- Structure parity requires matching type + board cell + owner at required comparison points.

#### Player-visible outcome boundary

- Parity sign-off is based on matching outcome + resulting state + rejection reason.
- Player-facing ordering of quick-succession outcomes must be preserved.
- Meaning/outcome equivalence is required; exact wording/UI polish is not.
- Non-visible drift (for example internal IDs/debug counters) does not block sign-off.

### OpenCode's Discretion

- Exact helper/module boundaries for removing duplicate geometry from `rts.ts`.
- Exact representative scenario matrix breadth and fixture shape.
- Whether temporary migration assertions live in runtime code or stay test-only.

### Deferred Ideas (OUT OF SCOPE)

- None.

</user_constraints>

<phase_requirements>

## Phase Requirements

| ID     | Description                                                                                                              | Research Support                                                                                                                        |
| ------ | ------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| REF-06 | Duplicate template/offset-template logic in `packages/rts-engine/rts.ts` is removed without authoritative outcome drift. | Extract remaining authoritative geometry glue from `rts.ts`, preserve reason/resource semantics, and lock representative parity checks. |

</phase_requirements>

## Summary

Phase 16 already moved preview/queue/apply to shared GridView-backed write helpers (`projectTemplateGridWritePlacement`, diff counting, apply mutation), but `packages/rts-engine/rts.ts` still carries authoritative geometry orchestration helpers and parity-critical guard ordering. The remaining risk for Phase 17 is not transform math; it is behavior drift while removing legacy duplication from authoritative paths.

The highest-risk drift points are rejection ordering (`outside-territory`, `template-exceeds-map-size`, `template-compare-failed`, `occupied-site`, `insufficient-resources`), repeated invalid-action cadence in timeline events, and execute-time resource/state checkpoints. These are user-visible outcomes even when implementation details change.

**Primary recommendation:** Introduce one dedicated authoritative placement-evaluation module for `rts.ts` consumers, delete duplicate geometry helpers from `rts.ts`, and gate cleanup with representative unit + integration parity checkpoints that compare action-by-action outcomes, rejection taxonomy, and deterministic resource/structure state.

## Standard Stack

### Core

| Library / Module                             | Version | Purpose                                                         | Why Standard                                                                 |
| -------------------------------------------- | ------- | --------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| In-repo `#rts-engine/template-grid-write.ts` | current | Canonical transformed projection, diff, and apply primitives    | Already authoritative for transformed world-cell traversal and write parity. |
| In-repo `#rts-engine/rts.ts`                 | current | Authoritative preview/queue/apply outcome orchestration         | Owns rejection taxonomy, timeline ordering, and resource charging semantics. |
| In-repo `#rts-engine/template-grid-read.ts`  | current | Canonical transformed read helpers used by integrity/build-zone | Keeps read/write transform semantics aligned during cleanup.                 |
| In-repo `#rts-engine/placement-transform.ts` | current | Transform normalization and torus wrapping primitives           | Preserves matrix semantics already validated in prior phases.                |

### Supporting

| Library / Tool                                      | Version | Purpose                                           | When to Use                                                                     |
| --------------------------------------------------- | ------- | ------------------------------------------------- | ------------------------------------------------------------------------------- |
| `vitest`                                            | 1.6.x   | Deterministic unit parity checks                  | Validate rejection ordering, parity checkpoints, and resource/state invariants. |
| Integration suites under `tests/integration/server` | current | Runtime contract and timeline parity verification | Confirm socket-level rejection semantics and action cadence remain stable.      |

### Alternatives Considered

| Instead of                                              | Could Use                                              | Tradeoff                                                                                        |
| ------------------------------------------------------- | ------------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| Extracting authoritative geometry helpers from `rts.ts` | Keep helper logic in `rts.ts` and remove only comments | Faster edits, but preserves duplicate-path debt and makes parity regressions harder to isolate. |
| Representative action-checkpoint parity fixtures        | End-state-only parity checks                           | Lower test cost, but misses rejection cadence and intermediate resource/structure drift.        |
| Test-only temporary old-vs-new assertions               | Runtime dual-path assertions in production code        | Runtime assertions add noise/risk; test-only assertions are safer and easier to retire.         |

**Installation:**

```bash
# No new dependencies are required.
npm install
```

## Architecture Patterns

### Pattern 1: Authoritative Placement Evaluation Module

**What:** Move projection + diff + affordability + reason derivation glue out of `rts.ts` into one focused helper module consumed by preview and execute-time revalidation.
**When to use:** `previewBuildPlacement`, `queueBuildEvent`, and `applyTeamEconomyAndQueue` evaluation paths.
**Why:** Removes duplicate template/offset-template flow remnants while keeping orchestration semantics in one place.

### Pattern 2: Action-Boundary Parity Checkpoints

**What:** Assert parity after each action boundary (preview, queue, tick/outcome) rather than final state only.
**When to use:** Representative success and invalid flows from `rts.test.ts` and integration suites.
**Why:** Directly enforces locked context decisions on rejection cadence and intermediate resource/structure state.

### Pattern 3: Rejection Taxonomy Stability at Runtime Boundary

**What:** Keep reason taxonomy assertions at both engine and socket event layers.
**When to use:** `build:preview`, `build:queue`, and `build:outcome` integration assertions.
**Why:** Preserves player-visible behavior while allowing internal helper refactors.

## Don't Hand-Roll

| Problem                                   | Don't Build                                        | Use Instead                                                | Why                                                                    |
| ----------------------------------------- | -------------------------------------------------- | ---------------------------------------------------------- | ---------------------------------------------------------------------- |
| Authoritative transformed projection flow | New ad hoc nested loops in multiple `rts.ts` paths | Shared `template-grid-write` projection/diff/apply helpers | Prevents drift between preview, queue revalidation, and execute apply. |
| Rejection taxonomy mapping                | New translation/remapping layer                    | Existing `BuildRejectionReason` ordering and semantics     | Avoids user-visible rejection behavior changes during cleanup.         |
| Deterministic parity sign-off             | End-state-only snapshots                           | Action-by-action checkpoints with timeline ordering checks | Captures cadence and intermediate resource drift regressions.          |

## Common Pitfalls

### Pitfall 1: Rejection-Order Drift During Helper Extraction

**What goes wrong:** Same invalid request starts returning a different top rejection reason.
**How to avoid:** Preserve guard order and keep explicit reason-order parity assertions in unit and integration suites.

### Pitfall 2: Repeated Invalid Attempts Change Outcome Cadence

**What goes wrong:** Duplicate invalid queues produce different timeline/outcome ordering after refactor.
**How to avoid:** Add representative repeated-invalid attempt scenarios and assert reason cadence per action boundary.

### Pitfall 3: Deterministic Checkpoint Drift Hidden by Final-State Match

**What goes wrong:** Final resources/structures match but intermediate checkpoints diverge.
**How to avoid:** Compare resources and structure sets after each queue/tick boundary in representative timelines.

### Pitfall 4: Text-Level Error Assertions Overconstrain Behavioral Equivalence

**What goes wrong:** Tests fail on wording changes while true semantic parity holds.
**How to avoid:** Assert reason taxonomy and outcomes, not exact UI phrasing.

## Code Examples

Current authoritative geometry touchpoints in `packages/rts-engine/rts.ts`:

```typescript
const projectedPlacement = projectBuildPlacement(
  room,
  team,
  template,
  x,
  y,
  transformInput,
);

const diffCells = compareTemplate(room, projectedPlacement.projection);
```

```typescript
if (applyTemplate(room, event.projection)) {
  // build accepted and structure persisted
}
```

These are strong extraction candidates for a dedicated authoritative helper surface while preserving orchestration order in `rts.ts`.

## State of the Art

| Old Approach                                                  | Current Approach                                                                       | Impact                                                                           |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Duplicate authoritative geometry glue spread through `rts.ts` | Shared GridView write primitives exist, but orchestration glue still local in `rts.ts` | Lower transform risk than before, but cleanup debt and parity-drift risk remain. |
| Broad confidence from prior migration phases                  | Representative action-checkpoint parity enforcement (recommended)                      | Better proof for outcome/reason/resource equivalence during legacy-path removal. |

## Open Questions

1. **Should temporary old-vs-new assertions be runtime or test-only in Phase 17?**
   - What we know: Context requires temporary migration assertions before final cleanup phase.
   - Recommendation: Keep assertions test-only in Phase 17; retire them in Phase 18 after parity closure.

2. **Should Phase 17 include full serial integration suite gating despite known timeout debt?**
   - What we know: Existing `room:match-finished` timeout debt can obscure targeted parity signal.
   - Recommendation: Use deterministic targeted parity scenarios as hard gates in Phase 17; keep full serial suite as secondary signal until timeout debt is resolved.

## Sources

### Primary (HIGH confidence)

- `packages/rts-engine/rts.ts` - authoritative preview/queue/apply orchestration and rejection/resource logic.
- `packages/rts-engine/template-grid-write.ts` - canonical transformed write projection/diff/apply helpers.
- `packages/rts-engine/rts.test.ts` - deterministic engine-level transformed parity coverage.
- `tests/integration/server/server.test.ts` - socket-level preview/queue/outcome parity assertions.
- `tests/integration/server/quality-gate-loop.test.ts` and `tests/integration/server/destroy-determinism.test.ts` - cadence and transformed structure-key determinism guards.
- `.planning/phases/17-legacy-geometry-removal-with-outcome-parity/17-CONTEXT.md` - locked parity decisions and scope boundary.

### Secondary (MEDIUM confidence)

- `.planning/ROADMAP.md` - phase goal, requirement mapping, and success criteria.
- `.planning/REQUIREMENTS.md` - `REF-06` traceability.
- `.planning/phases/16-write-path-gridview-unification/16-02-SUMMARY.md` - prior phase parity guard baseline.

## Metadata

**Confidence breakdown:**

- Cleanup strategy: HIGH - grounded in current `rts.ts` helper shape and existing shared GridView modules.
- Outcome risk profile: HIGH - directly aligned to locked context decisions and known parity drift vectors.
- Verification strategy: HIGH - uses deterministic unit + integration scenarios already present in this codebase.

**Research date:** 2026-03-03
**Valid until:** 2026-04-02 (or until major authoritative queue/apply orchestration changes land)
