# Phase 15: Read-Path and Cross-Codebase GridView Unification - Research

**Researched:** 2026-03-03
**Domain:** GridView-backed read-path migration and transformed-grid helper unification
**Confidence:** HIGH

<user_constraints>

## User Constraints (from CONTEXT.md)

### Locked Decisions

#### Parity boundaries

- Parity is observable-equivalent: player-visible transformed cells must match current behavior.
- Non-observable internal differences are allowed only when explicitly allowlisted and documented.
- Phase is blocked by any non-allowlisted parity delta that changes player-visible outcomes.

#### Overlay stability

- After reconnect, structure/build-zone overlay cells remain identical for the same game state.
- Repeated rotate/translate sequences must show no visible wobble or state flip-flop.
- Mid-session reconnect restores prior overlay orientation/position context instead of resetting defaults.
- If overlay data is briefly unavailable post-reconnect, show last-known overlay with a stale indicator until refreshed.

#### Scenario matrix

- Validate a full transform matrix (rotations plus representative translations, including origin and edge placements).
- Include sparse, dense, and edge-heavy board-state contexts in parity validation.
- Cover both single reconnect and repeated reconnect loops.
- Require deterministic outcomes across repeated runs of the same transform input timeline.

#### Ambiguous legacy cases

- When duplicated legacy paths disagree, default to preserving current player-visible behavior.
- For non-obvious ambiguities, prioritize session stability across reconnect and repeated transforms.
- Document every resolved ambiguity with the chosen behavior and expected outcome.
- If a late ambiguity cannot be fully resolved in this phase, allowlist the delta and create a follow-up item.

### OpenCode's Discretion

- Choose the exact authoritative legacy source per ambiguous duplicate path, as long as player-visible behavior is preserved.
- Define helper-level matching criteria for non-player-visible outputs (for example size-estimation paths) within observable-equivalence and allowlist rules.
- Choose the documentation structure for ambiguity logs and allowlist entries.

### Deferred Ideas (OUT OF SCOPE)

- None.

</user_constraints>

<phase_requirements>

## Phase Requirements

| ID     | Description                                                                                                                                               | Research Support                                                                                                                                                          |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| REF-05 | Structure projection, build-zone contributor projection, and integrity-mask checks use the same GridView-backed geometry pipeline.                        | Consolidate read-path geometry helpers into one shared module consumed by all read-side callsites in `packages/rts-engine/rts.ts`.                                        |
| REF-07 | Other duplicate transformed-grid code paths (including integration helper size estimation) use shared GridView/transform utilities with matching results. | Replace ad hoc transformed-size heuristics in integration helpers with shared `#rts-engine` utilities and add parity-focused regression coverage for rotate/mirror cases. |

</phase_requirements>

## Summary

Phase 14 completed the canonical `template.grid()` and `GridView` transform migration, but the read-path projection logic still lives as local helpers inside `packages/rts-engine/rts.ts` (`transformTemplateWithGridView`, `projectTransformedTemplateToWorld`, and related integrity/build-zone readers). Those helpers now behave as the de facto canonical read pipeline, but they are not yet exported as shared primitives for other code paths.

Cross-codebase duplication is still present in integration test helper paths. In particular, `tests/integration/server/quality-gate-loop.test.ts` uses a local `estimateTransformedTemplateSize` function that only tracks rotate parity by counting odd quarter-turns and does not represent full matrix semantics. This is a direct candidate for REF-07 migration onto shared GridView-backed utilities.

Overlay stability requirements are mostly supported by existing runtime behavior (`projectStructures` + `collectBuildZoneContributors` in engine and sync-hint logic in web tactical overlay view model), but phase sign-off should be driven by explicit reconnect + repeated-transform parity tests to guard against wobble/state flip-flop regressions while read paths are being unified.

**Primary recommendation:** Extract the read-path transform/projection primitives into a shared `packages/rts-engine` module, migrate integration helper sizing/projection paths to that module, and add reconnect matrix-parity tests plus a phase-local ambiguity log for any behavior-preservation decisions.

## Standard Stack

### Core

| Library / Module                             | Version | Purpose                                             | Why Standard                                                                                                 |
| -------------------------------------------- | ------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| In-repo `#rts-engine/grid-view.ts`           | current | Canonical transformed-cell and bounds contract      | Already authoritative for transform semantics and deterministic cell ordering from Phase 13/14.              |
| In-repo `#rts-engine/placement-transform.ts` | current | Canonical transform operation normalization         | Provides matrix contract shared by runtime payload normalization and GridView transforms.                    |
| In-repo `#rts-engine/rts.ts`                 | current | Authoritative read/write gameplay projection paths  | Current read-path behavior source that must be preserved while extracting reusable helpers.                  |
| In-repo `#rts-engine/build-zone.ts`          | current | Canonical contributor center and coverage semantics | Already shared by engine and web overlay projection; keep as unchanged downstream consumer of read geometry. |

### Supporting

| Library / Tool                              | Version | Purpose                                  | When to Use                                                                  |
| ------------------------------------------- | ------- | ---------------------------------------- | ---------------------------------------------------------------------------- |
| `vitest`                                    | 1.6.x   | Unit + integration regression validation | Validate deterministic transformed-cell parity and reconnect stability.      |
| Integration tests under `tests/integration` | current | Cross-runtime parity checks              | Validate reconnect and transform scenarios against authoritative socket flow |

### Alternatives Considered

| Instead of                                     | Could Use                                                           | Tradeoff                                                                                                               |
| ---------------------------------------------- | ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Shared exported read-projection utilities      | Keep projection helpers private in `rts.ts` and duplicate elsewhere | Faster short-term, but preserves drift risk between engine and cross-codebase helper paths.                            |
| GridView/matrix-backed transformed-size helper | Keep quarter-turn-only `width/height` swap logic in tests           | Works only for narrow cases; silently diverges from canonical matrix semantics for mirrored/compound transform inputs. |
| Reconnect parity matrix tests                  | Rely on existing generic reconnect tests                            | Leaves overlay/read-path wobble regressions undetected until later phases.                                             |

**Installation:**

```bash
# No new dependencies are required.
npm install
```

## Architecture Patterns

### Recommended Project Structure

```text
packages/rts-engine/
|-- template-grid-read.ts          # NEW shared read-side GridView projection utilities
|-- template-grid-read.test.ts     # NEW deterministic/parity coverage for helper APIs
|-- rts.ts                         # consume shared read helper for structure, build-zone, integrity reads
`-- index.ts                       # export shared helper APIs for cross-codebase usage

tests/integration/server/
|-- server.test.ts                 # consume shared transformed-size utility in candidate placement helper
`-- quality-gate-loop.test.ts      # replace local transformed-size logic with shared utility

.planning/phases/15-read-path-and-cross-codebase-gridview-unification/
`-- 15-AMBIGUITIES.md              # resolved ambiguity + allowlist record for this migration
```

### Pattern 1: One Shared Read Projection Pipeline

**What:** Keep template transform + world projection + integrity/read masks in one exported helper module.
**When to use:** Structure payload projection, build-zone contributor projection inputs, integrity mask reads, and test-side transformed-size estimation.
**Example:**

```typescript
// Source: packages/rts-engine/rts.ts (current in-file canonical flow)
const transformedTemplate = transformTemplateWithGridView(
  template,
  structure.transform,
);
const projection = projectTransformedTemplateToWorld(
  transformedTemplate,
  structure.x,
  structure.y,
  room.width,
  room.height,
);
```

### Pattern 2: Matrix-First Transform Derivation

**What:** Derive transformed dimensions/cells from normalized transform matrices rather than operation-count shortcuts.
**When to use:** Any helper that computes transformed width/height, bounds, or world cell projection.
**Example:**

```typescript
const normalized = normalizePlacementTransform(payload.transform);
const gridView = template.grid().applyTransform(normalized.matrix);
const bounds = gridView.bounds();
```

### Pattern 3: Reconnect Overlay Parity as Contract Test

**What:** Treat reconnect + repeated-transform overlay consistency as a deterministic contract and assert it explicitly.
**When to use:** Integration tests that validate state convergence and projected structure/build-zone geometry parity.
**Example:**

```typescript
expect(reconnectTeam.structures).toEqual(hostTeam.structures);
expect(reconnectTeam.pendingDestroys).toEqual(hostTeam.pendingDestroys);
```

### Anti-Patterns to Avoid

- Reintroducing private transform/read helpers in tests or runtime modules when canonical shared helpers exist.
- Validating only rotate-only cases while omitting mirrored/compound operation coverage.
- Accepting undocumented read-path behavior deltas during migration without explicit allowlist entries.

## Don't Hand-Roll

| Problem                              | Don't Build                                            | Use Instead                                             | Why                                                                 |
| ------------------------------------ | ------------------------------------------------------ | ------------------------------------------------------- | ------------------------------------------------------------------- |
| Transformed template size estimation | Quarter-turn counters and width/height swaps           | Shared GridView/matrix-backed helper from `#rts-engine` | Keeps helper behavior aligned with canonical transform semantics.   |
| Read-path projection parity          | Per-callsite loops recomputing transformed world cells | Shared template read projection utility module          | Prevents drift across structure, build-zone, and integrity readers. |
| Reconnect stability verification     | One-off manual checks                                  | Deterministic integration parity scenarios              | Ensures regressions are caught before later legacy-removal phases.  |

**Key insight:** Phase 15 risk is no longer missing GridView capability; it is semantic drift from duplicated projection logic outside the canonical helper path.

## Common Pitfalls

### Pitfall 1: Rotate-Only Helper Assumptions

**What goes wrong:** Helper behavior diverges for mirrored/compound transforms.
**Why it happens:** Integration helpers model transforms as odd/even rotate count only.
**How to avoid:** Route helper math through normalized matrix + GridView bounds APIs.
**Warning signs:** Helper predicts dimensions/placement candidates that differ from preview payload bounds.

### Pitfall 2: Read-Path Refactor Accidentally Touches Write Semantics

**What goes wrong:** Queue/apply behavior drifts during read-path extraction.
**Why it happens:** Shared helper extraction leaks into write-path decision logic.
**How to avoid:** Keep phase scope focused on read-side consumers and parity assertions.
**Warning signs:** New queue/apply rejections or changed resource-charge behavior in unrelated tests.

### Pitfall 3: Missing Ambiguity Tracking During Migration

**What goes wrong:** Non-obvious behavior differences are discovered late with no audit trail.
**Why it happens:** Decisions are embedded in code/test updates without explicit documentation.
**How to avoid:** Maintain a phase-local ambiguity log with chosen baseline and parity rationale.
**Warning signs:** Reviewers cannot explain why a read-path output changed even if tests pass.

## Code Examples

Verified in current codebase:

### Canonical template-to-world projection path

```typescript
// Source: packages/rts-engine/rts.ts
const transformedTemplate = transformTemplateWithGridView(template, transform);
const projected = projectTransformedTemplateToWorld(
  transformedTemplate,
  x,
  y,
  room.width,
  room.height,
);
```

### Existing duplicate helper path to retire

```typescript
// Source: tests/integration/server/quality-gate-loop.test.ts
function estimateTransformedTemplateSize(template, transform) {
  const operations = transform?.operations ?? [];
  let quarterTurns = 0;
  for (const operation of operations) {
    if (operation === 'rotate') {
      quarterTurns = (quarterTurns + 1) % 4;
    }
  }
  return quarterTurns % 2 === 1
    ? { width: template.height, height: template.width }
    : { width: template.width, height: template.height };
}
```

## State of the Art

| Old Approach                                         | Current Approach                                                 | When Changed | Impact                                                                 |
| ---------------------------------------------------- | ---------------------------------------------------------------- | ------------ | ---------------------------------------------------------------------- |
| Legacy projection entrypoints (`projectTemplate...`) | Retired; canonical path is `template.grid().applyTransform(...)` | Phase 14     | Runtime now has one transform contract, but helper sharing is pending. |
| Local transformed-size helper in integration tests   | Should migrate to shared GridView/matrix utility                 | Phase 15     | Removes helper drift and improves parity confidence.                   |

**Deprecated/outdated:**

- `projectTemplateWithTransform` and `projectPlacementToWorld` runtime APIs are intentionally fail-fast and no longer canonical read paths.

## Open Questions

1. **Which helper surface should be exported for integration candidate placement scans?**
   - What we know: tests need transformed bounds from template summary + transform input.
   - What's unclear: whether to expose a narrow bounds helper or broader projection helper that also returns transformed cells.
   - Recommendation: start with a narrow transformed-bounds helper backed by GridView matrix semantics, then expand only if tests require more.

2. **How should unresolved parity ambiguities be tracked if discovered late in execution?**
   - What we know: context requires explicit allowlist + follow-up item.
   - What's unclear: exact location/format in current phase docs.
   - Recommendation: use `15-AMBIGUITIES.md` in phase directory with status tags (`resolved`, `allowlisted-followup`) and test evidence links.

## Sources

### Primary (HIGH confidence)

- `packages/rts-engine/rts.ts` - current canonical read-side transform and projection helpers.
- `packages/rts-engine/grid-view.ts` - canonical transformed-cell/bounds semantics.
- `packages/rts-engine/placement-transform.ts` - canonical transform normalization contract.
- `tests/integration/server/quality-gate-loop.test.ts` - duplicate transformed-size helper path.
- `tests/integration/server/server.test.ts` - integration placement helper path using template dimensions.
- `apps/web/src/tactical-overlay-view-model.ts` - reconnect stale hint behavior for overlay synchronization.
- `.planning/phases/15-read-path-and-cross-codebase-gridview-unification/15-CONTEXT.md` - locked user decisions and parity constraints.

### Secondary (MEDIUM confidence)

- `.planning/ROADMAP.md` - phase goal, requirement mapping, and success criteria for REF-05/REF-07.
- `.planning/REQUIREMENTS.md` - milestone requirement definitions and scope boundaries.

## Metadata

**Confidence breakdown:**

- Standard stack: HIGH - fully based on current in-repo architecture.
- Architecture patterns: HIGH - directly inferred from active runtime/test callsites.
- Pitfalls: HIGH - tied to concrete duplicate helper and parity-risk locations in current code.

**Research date:** 2026-03-03
**Valid until:** 2026-04-02 (or until Phase 15 implementation materially changes read-path helper surfaces)
