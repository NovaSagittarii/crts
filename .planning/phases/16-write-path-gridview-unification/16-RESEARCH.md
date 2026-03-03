# Phase 16: Write-Path GridView Unification - Research

**Researched:** 2026-03-03
**Domain:** Preview/queue/apply write-path unification on canonical GridView geometry
**Confidence:** HIGH

<user_constraints>

## User Constraints (from CONTEXT.md)

### Locked Decisions

#### Rejection reason precedence

- Preserve current precedence ordering when multiple legality checks fail.
- Preserve existing reason codes and wording surface.
- Return exactly one deterministic top rejection reason.
- Use existing generic rejection reason when a migrated failure path cannot map directly.

#### Preview/apply consistency

- Preview and queue validation must use the same ruleset.
- Queue/apply must revalidate against current state and may reject even if earlier preview was legal.
- Current-state rejects must surface the current-state reason (no custom taxonomy).
- Reject flows must trigger an authoritative preview refresh so placement feedback is not stale.

#### Transform edge behavior on torus map

- Treat map topology as torus for transformed write paths.
- Geometrically equivalent orientations must resolve to the same legality result.
- Seam crossings must use exact wrapped transformed cells.
- Preview seam footprints must match where apply writes.
- Overlap semantics remain unchanged: structure placement still overwrites prior cells.

#### Resource charge timing

- Keep current charge timing and no speculative charges.
- If apply-time revalidation rejects, do not charge.
- Preview affordability values must remain exact and authoritative.
- Apply-time affordability rejection must report current-state affordability reason and metadata.

### OpenCode's Discretion

- Exact helper/module boundaries for write-path projection and diff/apply loops.
- Exact parity matrix breadth for transformed seam and equivalent-orientation scenarios.
- Whether preview refresh-on-reject is validated via existing state-driven refresh flow or explicit rejection-triggered probes.

### Deferred Ideas (OUT OF SCOPE)

- Preventing structure overlap on placement.

</user_constraints>

<phase_requirements>

## Phase Requirements

| ID     | Description                                                                                            | Research Support                                                                                                                        |
| ------ | ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| REF-04 | Build preview, queue validation, and build apply flows use the same GridView-backed geometry pipeline. | Consolidate write-path projection/diff/apply traversal into shared GridView-backed helpers and lock parity with unit+integration gates. |

</phase_requirements>

## Summary

Phase 15 unified read-path consumers, but write-path logic is still spread across local helpers in `packages/rts-engine/rts.ts` (`projectBuildPlacement`, `compareTemplate`, `applyTemplate`, and execute-time queue revalidation in `applyTeamEconomyAndQueue`). While these paths already consume GridView-transformed templates, they still duplicate traversal concerns across legality, diff-cost, and apply mutation loops.

The highest risk for Phase 16 is semantic drift between what preview/queue report and what apply mutates at execute time, especially around transformed seam crossings, rejection precedence, and structure-key stability (`createStructureKey(x,y,width,height)`).

**Primary recommendation:** Introduce one shared write-path helper module that projects transformed GridView cells into deterministic world-cell streams and reuse it for preview legality, diff-cost evaluation, and apply mutation. Then add explicit parity gates proving transformed preview -> queue -> apply alignment plus unchanged reason/resource behavior.

## Standard Stack

### Core

| Library / Module                             | Version | Purpose                                          | Why Standard                                                                 |
| -------------------------------------------- | ------- | ------------------------------------------------ | ---------------------------------------------------------------------------- |
| In-repo `#rts-engine/grid-view.ts`           | current | Canonical transformed cell contract              | Already authoritative for transform ordering and full alive/dead traversal.  |
| In-repo `#rts-engine/template-grid-read.ts`  | current | Canonical transform + world projection utilities | Existing shared read-side patterns can be mirrored for write-path helpers.   |
| In-repo `#rts-engine/rts.ts`                 | current | Authoritative write validation and apply flow    | Current source of truth for reason taxonomy, charging timing, and outcomes.  |
| In-repo `#rts-engine/placement-transform.ts` | current | Transform normalization and wrap semantics       | Preserves operation-order semantics and matrix parity already in production. |

### Supporting

| Library / Tool                              | Version | Purpose                              | When to Use                                                                      |
| ------------------------------------------- | ------- | ------------------------------------ | -------------------------------------------------------------------------------- |
| `vitest`                                    | 1.6.x   | Unit + integration parity regression | Lock transformed parity and rejection/resource invariants.                       |
| Integration tests under `tests/integration` | current | Cross-runtime contract verification  | Verify reason/rejection payload parity and transformed preview refresh behavior. |

### Alternatives Considered

| Instead of                                         | Could Use                                                   | Tradeoff                                                                                       |
| -------------------------------------------------- | ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Shared write helper module                         | Keep write traversal in separate local loops                | Faster short term, but preserves drift risk between preview legality and apply mutation paths. |
| GridView-cell-stream diff/apply implementation     | Keep width/height nested loops over transformed byte arrays | Works today, but keeps duplicate traversal logic and makes parity auditing harder.             |
| Deterministic transformed matrix parity test suite | Rely only on existing happy-path queue/apply tests          | Misses edge-orientation parity and current-state reject timing regressions.                    |

**Installation:**

```bash
# No new dependencies are required.
npm install
```

## Architecture Patterns

### Pattern 1: One Canonical Write Projection Snapshot

**What:** Build one deterministic projection object per placement input and feed legality, diff-cost, and apply from that same geometry snapshot.
**When to use:** `previewBuildPlacement`, execute-time revalidation in `applyTeamEconomyAndQueue`, and `tickRoom` apply loops.
**Example targets:** `projectBuildPlacement`, `compareTemplate`, `applyTemplate` in `packages/rts-engine/rts.ts`.

### Pattern 2: GridView Cell Stream for Diff and Apply

**What:** Reuse transformed GridView cell traversal (including alive and dead cells) for both diff counting and room grid mutation.
**When to use:** Cost calculation (`diffCells`) and template application writes.
**Why:** Eliminates traversal divergence where preview legality and apply mutation could eventually desync.

### Pattern 3: Revalidation-First Queue Execution

**What:** Keep execute-time revalidation authoritative and reason-stable while reusing the same write projection pipeline as preview.
**When to use:** `applyTeamEconomyAndQueue` before event acceptance and resource deduction.
**Why:** Preserves current behavior where state drift between preview and execute tick can produce valid rejections.

## Don't Hand-Roll

| Problem                                 | Don't Build                                      | Use Instead                                          | Why                                                                  |
| --------------------------------------- | ------------------------------------------------ | ---------------------------------------------------- | -------------------------------------------------------------------- |
| Write-path transformed traversal        | Per-callsite ad hoc nested loops                 | Shared write helper over canonical transformed cells | Keeps preview, queue, and apply on one geometry source.              |
| Rejection reason precedence translation | New reason remapping tables in runtime/UI layers | Existing engine reason taxonomy/order                | Preserves player-facing behavior and deterministic rejection output. |
| Structure key shape derivation tweaks   | Alternate key composition for transformed writes | Existing `createStructureKey(x,y,width,height)`      | Avoids destroy/occupied-site regressions under transformed bounds.   |

## Common Pitfalls

### Pitfall 1: Preview/Apply Coordinate Drift

**What goes wrong:** Preview footprint appears legal but apply mutates a different wrapped footprint.
**How to avoid:** Reuse one canonical transformed world-cell stream for legality and apply, and assert footprint parity in unit/integration tests.

### Pitfall 2: Rejection Precedence Regression During Helper Extraction

**What goes wrong:** Correct rejection reasons change order (for example `outside-territory` vs `insufficient-resources`) after refactor.
**How to avoid:** Preserve existing guard order and add explicit precedence matrix tests.

### Pitfall 3: Structure Key Drift on Transformed Bounds

**What goes wrong:** Equivalent transformed placements generate different keys, breaking occupied-site and destroy targeting expectations.
**How to avoid:** Keep key generation anchored to existing transformed bounds semantics and add regression fixtures for orientation-equivalent placements.

### Pitfall 4: Resource Charge Timing Drift

**What goes wrong:** Resources are charged on queue acceptance instead of execute acceptance, or charged after execute rejection.
**How to avoid:** Keep deductions in execute-time accepted path only and add tests that verify no charge on execute-time rejects.

## Code Examples

Current write-path hotspots in `packages/rts-engine/rts.ts`:

```typescript
const projectedPlacement = projectBuildPlacement(
  room,
  team,
  template,
  x,
  y,
  transformInput,
);

diffCells = compareTemplate(
  room,
  projectedPlacement.projection.transformedTemplate,
  projectedPlacement.projection.bounds,
);
```

```typescript
if (
  applyTemplate(
    room,
    event.projection.transformedTemplate,
    event.projection.bounds,
  )
) {
  // accept + persist structure
}
```

## State of the Art

| Old Approach                                           | Current Approach                                                                   | Impact                                                                           |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Legacy transform projection entrypoints in write paths | GridView-backed transformed templates, but write traversal still split in `rts.ts` | Better transform parity than pre-14, but helper-level write duplication remains. |
| Implicit parity confidence from shared evaluate path   | Explicit write-helper and parity-matrix tests (recommended)                        | Lowers risk of future drift during phase 17 legacy-path deletion.                |

## Open Questions

1. **Should preview refresh-on-reject remain state-driven or become explicit on `build:outcome` rejection?**
   - What we know: queue rejection already triggers immediate refreshed preview from server; state updates also trigger preview refresh in client.
   - Recommendation: lock current observable behavior in tests first, then introduce explicit outcome-reject probe only if gaps remain.

## Sources

### Primary (HIGH confidence)

- `packages/rts-engine/rts.ts` - current preview/queue/apply write-path helpers and reason/charge ordering.
- `packages/rts-engine/rts.test.ts` - existing preview/queue parity and queue/resource coverage.
- `apps/server/src/server.ts` - queue rejection mapping and refreshed preview emission behavior.
- `tests/integration/server/server.test.ts` - cross-runtime preview/queue/outcome contract assertions.
- `.planning/phases/16-write-path-gridview-unification/16-CONTEXT.md` - locked behavior decisions.

### Secondary (MEDIUM confidence)

- `.planning/ROADMAP.md` - phase goal and success criteria.
- `.planning/REQUIREMENTS.md` - requirement mapping for REF-04.
- `.planning/phases/15-read-path-and-cross-codebase-gridview-unification/15-01-SUMMARY.md` - shared helper migration patterns from prior phase.

## Metadata

**Confidence breakdown:**

- Architecture approach: HIGH - grounded in current write-path and prior phase helper patterns.
- Risk profile: HIGH - aligned with known transformed parity and key stability pitfalls.
- Test strategy: HIGH - uses existing unit + integration harnesses already enforcing deterministic behavior.

**Research date:** 2026-03-03
**Valid until:** 2026-04-02 (or until major write-path helper refactors land)
