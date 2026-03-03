# Phase 18: Parity Closure and Migration Cleanup - Research

**Researched:** 2026-03-03
**Domain:** Parity closure evidence and migration guard retirement in deterministic RTS tests
**Confidence:** HIGH

<user_constraints>

## User Constraints (from CONTEXT.md)

### Locked Decisions

#### Parity coverage scope

- Required parity gates cover preview, queue, apply, integrity, and structure-key stability across representative transform sequences.
- Mandatory coverage includes all supported transform orientations for each gated flow.
- Mandatory parity dimensions match exactly: accept/reject outcome, rejection reason taxonomy, and resulting resource/structure state outcomes.
- Any unexplained mismatch blocks phase completion until resolved.

### OpenCode's Discretion

- Choose the concrete representative transform sequences and fixtures, as long as all required gated flows and orientations are covered.
- Decide how to organize parity evidence outputs (test grouping, naming, and reporting format) in repo conventions.
- Sequence migration-assertion cleanup work in the safest order, provided temporary migration-only assertions are fully retired before phase close and parity suites stay green.

### Deferred Ideas (OUT OF SCOPE)

- None - discussion stayed within phase scope.

</user_constraints>

<phase_requirements>

## Phase Requirements

| ID     | Description                                                                                                                                          | Research Support                                                                                                                                  |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| REF-08 | Unit and integration tests prove parity for preview, queue, apply, integrity, and structure-key stability across representative transform sequences. | Keep targeted deterministic parity suites as the execution gate and tighten transformed matrix assertions across unit and integration boundaries. |
| REF-09 | Temporary old-vs-new assertions are used during migration and removed before milestone close once parity is proven.                                  | Replace migration-only old-vs-new harnesses with canonical expected-outcome assertions and remove temporary migration guard markers.              |

</phase_requirements>

## Summary

Phase 17 left two explicit migration-only guards in place: one in `packages/rts-engine/template-grid-authoritative.test.ts` and one in `packages/rts-engine/rts.test.ts`. Both currently compare against temporary old-vs-new scaffolding that was useful for safe extraction, but those temporary checks now need to be retired to satisfy `REF-09`.

Parity signal for `REF-08` already exists across targeted unit and integration tests, but the closure risk is confidence drift while removing migration scaffolding. The safest approach is to keep (and in some places strengthen) deterministic parity checkpoints using canonical expected outcomes and transform-equivalence scenarios, then remove migration-only comments/helpers after coverage proves stable.

**Primary recommendation:** Convert temporary migration harnesses to permanent canonical parity contracts in unit tests first, then tighten cross-runtime integration parity gates for preview/queue/apply/integrity/structure-key stability and complete Phase 18 with migration-only assertions fully removed.

## Standard Stack

### Core

| Library / Module                                          | Version | Purpose                                             | Why Standard                                                                                                                                       |
| --------------------------------------------------------- | ------- | --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `vitest`                                                  | 1.6.x   | Deterministic unit and integration parity execution | Existing repository test runner with phase-proven targeted command patterns.                                                                       |
| `packages/rts-engine/rts.test.ts`                         | current | Engine-level preview/queue/apply parity checkpoints | Already houses representative transformed timeline parity scenarios that should be promoted from migration guard to permanent contract.            |
| `packages/rts-engine/template-grid-authoritative.test.ts` | current | Authoritative helper evaluation parity checks       | Contains the temporary legacy parity harness that must be converted to canonical assertions in this phase.                                         |
| `tests/integration/server/*.test.ts`                      | current | Socket-level and lifecycle parity evidence          | Existing deterministic integration scenarios already cover rejection taxonomy, cadence, integrity behavior, and structure-key targeting stability. |

### Supporting

| Library / Tool                                       | Version | Purpose                                                        | When to Use                                                                |
| ---------------------------------------------------- | ------- | -------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `apps/server/src/server.ts` test harness             | current | Runtime contract boundary under Socket.IO                      | Validate externally visible parity after migration-guard retirement.       |
| `#rts-engine` transform helpers in integration tests | current | Candidate placement generation and transform bounds estimation | Ensure transform-equivalence scenarios are deterministic and reproducible. |

### Alternatives Considered

| Instead of                                                      | Could Use                                        | Tradeoff                                                                                   |
| --------------------------------------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| Replacing old-vs-new harnesses with canonical expected outcomes | Keep migration harnesses until milestone close   | Easier short term, but violates `REF-09` and leaves temporary assertions in shipped code.  |
| Targeted parity gates used in prior phases                      | Full `test:integration:serial` as mandatory gate | Broader coverage but known timeout debt can hide parity signal and slow feedback loops.    |
| Action-boundary and scenario-matrix checks                      | End-state-only parity checks                     | Faster to write, but misses cadence and intermediate state drift that Phase 18 must guard. |

**Installation:**

```bash
# No new dependencies are required.
npm install
```

## Architecture Patterns

### Pattern 1: Canonical Parity Contract Assertions (No Legacy Mirror)

**What:** Replace temporary old-vs-new comparator functions with explicit expected outcomes for transformed success and rejection paths.
**When to use:** `template-grid-authoritative.test.ts` and representative timeline checks in `rts.test.ts`.
**Why:** Keeps parity protection while removing migration-only scaffolding.

### Pattern 2: Transform-Equivalence Matrix Across Runtime Boundaries

**What:** Assert equivalent transforms (identity-equivalent and rotated/mirrored) produce matching preview, queue, outcome, and affordability metadata behavior.
**When to use:** `server.test.ts` and `quality-gate-loop.test.ts` parity scenarios.
**Why:** Preserves user-visible contract parity where refactor drift is most costly.

### Pattern 3: Deterministic Rerun + Structure-Key Stability Evidence

**What:** Keep rerun snapshots and transformed structure-key/destroy targeting checks as hard gates.
**When to use:** `destroy-determinism.test.ts` and `match-lifecycle.test.ts` representative scenarios.
**Why:** Ensures parity proof includes integrity and lifecycle ordering, not only isolated build outcomes.

## Don't Hand-Roll

| Problem                    | Don't Build                                          | Use Instead                                                                  | Why                                                                           |
| -------------------------- | ---------------------------------------------------- | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Migration guard retirement | New ad hoc scripts that parse test output for parity | Existing deterministic Vitest scenario assertions in unit/integration suites | Direct assertions are reviewable and fail fast at source behavior boundaries. |
| Transform parity checks    | One-off random transform fuzz loops                  | Existing candidate placement helpers and representative transform fixtures   | Deterministic fixtures avoid flaky signal and support repeatable regressions. |
| Contract drift detection   | Broad suite-only gating with no targeted checks      | Targeted parity test commands per flow                                       | Faster feedback and clearer failure attribution for Phase 18 scope.           |

## Common Pitfalls

### Pitfall 1: Removing Temporary Harnesses Before Equivalent Coverage Exists

**What goes wrong:** Migration comments/helpers are deleted before replacement assertions are in place.
**How to avoid:** First replace with canonical outcome assertions, then remove migration-only scaffolding in the same plan.

### Pitfall 2: Keeping Parity Assertions but Losing Rejection Cadence Signal

**What goes wrong:** Tests still check reason taxonomy but no longer verify action-boundary ordering.
**How to avoid:** Preserve per-boundary checkpoints for queue and outcome sequencing in representative timelines.

### Pitfall 3: Over-relying on Broad Flaky Suites for Sign-off

**What goes wrong:** Serial integration timeout noise obscures whether parity closure actually passed.
**How to avoid:** Keep deterministic targeted suite commands as hard gate and use broad suites as secondary signal.

### Pitfall 4: Asserting Unstable Fields Instead of Behavioral Contract

**What goes wrong:** Tests fail due to non-contract metadata churn while behavior is unchanged.
**How to avoid:** Assert accepted/rejected outcomes, reason taxonomy, affordability fields, and resulting state checkpoints that players observe.

## Code Examples

Current temporary migration guard markers to retire:

```typescript
// packages/rts-engine/rts.test.ts
test('keeps representative action-timeline parity after legacy geometry cleanup', () => {
  // Temporary migration guard: remove this old-vs-new checkpoint suite in Phase 18.
  // ...
});
```

```typescript
// packages/rts-engine/template-grid-authoritative.test.ts
test('keeps legacy parity for representative transformed evaluation outcomes', () => {
  // Temporary migration guard: remove legacy parity harness in Phase 18.
  // ...
});
```

## State of the Art

| Old Approach                                        | Current Approach                                                                                  | Impact                                                                          |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Temporary legacy-mirror assertions during migration | Shared authoritative helper is already in production path; temporary mirrors remain only in tests | Cleanup can now remove migration-only scaffolding without losing parity signal. |
| Goal proof centered on Phase 17 extraction safety   | Goal proof must now include migration assertion retirement plus parity continuity                 | Phase 18 closes milestone readiness and requirement `REF-09`.                   |

## Open Questions

1. **Should unit parity tests keep "legacy" wording in names after migration cleanup?**
   - What we know: wording does not affect behavior, but can imply temporary scope.
   - Recommendation: optional rename if low risk; prioritize behavior and assertion quality over naming churn.

2. **Do we promote additional broad-suite gates in this phase despite known timeout debt?**
   - What we know: targeted deterministic commands already validate required `REF-08` flows.
   - Recommendation: keep targeted deterministic gates as blockers; treat broad serial suite as non-blocking signal until timeout debt is fixed.

## Sources

### Primary (HIGH confidence)

- `packages/rts-engine/rts.test.ts` - representative timeline parity guard and migration marker.
- `packages/rts-engine/template-grid-authoritative.test.ts` - legacy parity harness and migration marker.
- `tests/integration/server/server.test.ts` - preview/queue/apply parity and rejection cadence integration evidence.
- `tests/integration/server/quality-gate-loop.test.ts` - transform legality/affordability parity and integrity-adjacent flow coverage.
- `tests/integration/server/destroy-determinism.test.ts` - transformed structure-key and destroy-target parity checks.
- `tests/integration/server/match-lifecycle.test.ts` - deterministic queued outcome ordering across reruns.
- `.planning/phases/18-parity-closure-and-migration-cleanup/18-CONTEXT.md` - locked decisions and scope.

### Secondary (MEDIUM confidence)

- `.planning/ROADMAP.md` - phase goal and success criteria.
- `.planning/REQUIREMENTS.md` - `REF-08` and `REF-09` requirement definitions.
- `.planning/phases/17-legacy-geometry-removal-with-outcome-parity/17-01-SUMMARY.md` - migration guard intent and cleanup handoff context.

## Metadata

**Confidence breakdown:**

- Standard stack: HIGH - all recommendations use existing in-repo test infrastructure.
- Architecture patterns: HIGH - aligned with current parity gate patterns used in Phases 16 and 17.
- Pitfalls: HIGH - directly grounded in known migration guard locations and integration timeout debt.

**Research date:** 2026-03-03
**Valid until:** 2026-04-02 (or until parity suites are significantly restructured)
