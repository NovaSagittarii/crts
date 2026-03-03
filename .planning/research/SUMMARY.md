# Project Research Summary

**Project:** Conway RTS TypeScript Prototype
**Domain:** Deterministic multiplayer Conway RTS - v0.0.3 Template/GridView unification refactor
**Researched:** 2026-03-03
**Confidence:** HIGH

## Executive Summary

This milestone is a behavior-preserving internal refactor, not a gameplay expansion. The product remains a server-authoritative, deterministic two-player Conway RTS; the v0.0.3 objective is to replace duplicated template vs offset-template geometry paths with one canonical `template.grid()` -> `GridView` pipeline while keeping preview, queue, apply, integrity, destroy, and overlays behaviorally identical.

The recommended implementation strategy is strict backend/tests-first migration on the existing stack, with no new npm dependencies. Introduce `GridView` as an immutable primitive in `packages/rts-engine`, normalize templates at room/template construction boundaries, migrate read paths before write paths, and only remove legacy geometry code after parity tests prove equivalence. Server/web socket contracts should remain unchanged for this milestone.

The highest risks are geometry contract drift and deterministic drift: incomplete `cells()` output, transform semantic mismatch, mixed local/world wrapping, and partial migration across preview/queue/apply/integrity. Mitigation is clear and actionable: freeze `GridView` contract first, reuse existing transform helpers, migrate all geometry consumers together, enforce deterministic ordering invariants, and keep integration payload/reason assertions strict until legacy paths are deleted.

## Key Findings

### Recommended Stack

Research is strongly aligned: ship v0.0.3 on the current TypeScript/Node/Vitest toolchain and avoid dependency churn. This is an internal API unification milestone, so value comes from tighter contracts and parity coverage, not from new libraries.

**Core technologies:**

- `TypeScript@^5.4.5` (keep): strict typing for `GridView` APIs and migration safety.
- Node ESM + package import aliases (keep): one canonical `#rts-engine` API shared by server/web/tests.
- `Vitest@^1.6.0` (keep): deterministic parity checks for old/new geometry paths.
- `ESLint@^9.19.0` + `typescript-eslint@^8.26.0` (keep): catches unsafe mutation and contract drift during cleanup.
- Internal reuse (`placement-transform.ts`, `index.ts` exports): preserve authoritative transform semantics while exposing `GridView` cleanly.

**Critical version requirements:**

- Keep current runtime/tooling versions unchanged for this milestone (`typescript@^5.4.5`, `vitest@^1.6.0`, `vite@^5.2.0`, current Socket.IO pair).
- Do not combine this refactor with dependency modernization.

### Expected Features

Feature research defines a tight closure target centered on `REF-01` through `REF-04` plus parity proofing.

**Must have (table stakes):**

- `REF-01`: `template.grid()` is the canonical transformable template entrypoint.
- `REF-02`: `GridView.translate`, `GridView.rotate`, `GridView.applyTransform` preserve existing semantics via shared helpers.
- `REF-03`: `GridView.cells()` returns deterministic transformed `{ x, y, alive }` for all cells (not alive-only).
- `REF-04`: Duplicate template/offset-template logic is removed with no authoritative outcome drift.
- `REF-QUAL`: Unit and integration parity safety net proves preview/queue/apply/integrity equivalence.

**Should have (post-parity, still v0.0.3.x):**

- `REF-05A`: shared adapters for repeated GridView consumer loops.
- `REF-05B`: lightweight transform projection caching only if profiling proves need.
- `REF-05C`: temporary old-vs-new assertions during migration, removed after lock.

**Defer (v0.0.4+):**

- Expanded transform model (arbitrary-angle/scaling/shearing).
- Template authoring/editor scope.
- Any wire contract or runtime stack redesign unrelated to this cleanup.

### Architecture Approach

Architecture is intentionally conservative: add one new engine primitive (`grid-view.ts`), keep `rts.ts` as orchestration layer, and preserve server/web/socket boundaries. Use template normalization at construction time, an immutable transform chain for all geometry consumers, and adapter-first migration so existing exports keep working while internals converge.

**Major components:**

1. `StructureTemplate.grid()` in `packages/rts-engine/rts.ts` - canonical entrypoint for transformable template views.
2. `packages/rts-engine/grid-view.ts` (new) - immutable `translate`/`rotate`/`applyTransform`/`cells` core.
3. `packages/rts-engine/placement-transform.ts` - authoritative transform normalization/math reused by `GridView`.
4. `packages/rts-engine/rts.ts` - migrate preview/queue/apply/integrity/projection to one GridView pipeline.
5. `packages/rts-engine` + `tests/integration/server` suites - parity and determinism gates before deleting legacy paths.

### Critical Pitfalls

1. **Incomplete or unstable `cells()` contract** - lock `width * height`, uniqueness, and row-major transformed ordering before migration.
2. **Transform semantic drift** - route GridView operations through existing transform helpers and fixture parity tests.
3. **Local/world coordinate mixing and early wrapping** - keep GridView local-space only; wrap at projection boundary.
4. **Partial migration across engine consumers** - move preview/queue/apply/integrity/structure projection together, not piecemeal.
5. **Determinism and key stability regressions** - enforce ordering invariants and snapshot structure-key behavior across transform cases.

## Implications for Roadmap

Based on combined research, the most reliable plan is a **6-phase backend-first refactor sequence**.

### Phase 1: GridView Contract Freeze and Parity Harness

**Rationale:** Prevent silent drift before touching core geometry call sites.
**Delivers:** Contract tests for `cells()` count/uniqueness/order, immutability checks, old-vs-new fixture harness.
**Addresses:** `REF-03`, `REF-QUAL`.
**Avoids:** Pitfalls 1, 4, and deterministic flake risk.

### Phase 2: GridView Core Implementation

**Rationale:** Build and verify primitive in isolation before gameplay mutations.
**Delivers:** `grid-view.ts` + `grid-view.test.ts` with `translate`/`rotate`/`applyTransform`/`cells` behavior parity.
**Addresses:** `REF-02`, `REF-03`.
**Avoids:** Pitfalls 2 and 4.

### Phase 3: Template Normalization and Canonical API Adoption

**Rationale:** Introduce `template.grid()` with near-zero behavior change to reduce migration blast radius.
**Delivers:** Template normalization in room/template construction paths, `index.ts` export updates, compatibility adapters.
**Addresses:** `REF-01`.
**Avoids:** Mutable aliasing and migration ordering errors.

### Phase 4: Read-Path Migration (Projection/Overlay Inputs)

**Rationale:** Migrate non-mutating consumers first to validate data-shape parity early.
**Delivers:** GridView-backed structure projection, bounds/footprint derivation, build-zone contributor paths.
**Addresses:** `REF-04` (read paths), `REF-QUAL`.
**Avoids:** Pitfalls 3 and contract/test harness drift.

### Phase 5: Write-Path Migration (Preview/Queue/Apply/Integrity)

**Rationale:** Highest-risk mutation paths should move only after contracts and read paths are stable.
**Delivers:** Unified GridView geometry source for compare/apply/integrity and queue execution with deterministic parity gates.
**Addresses:** `REF-04`, `REF-QUAL`.
**Avoids:** Pitfalls 4, 5, 6, and 7.

### Phase 6: Legacy Path Deletion and Optional Low-Risk Simplification

**Rationale:** Remove debt only after full equivalence is proven; then ship scoped simplification safely.
**Delivers:** Deletion of old template/offset-template pathways; optional `REF-05A` and `REF-05B` if profiling-backed; removal of temporary migration assertions.
**Addresses:** `REF-05` and milestone closure hardening.
**Avoids:** Long-lived dual-path debt and hidden performance traps.

### Phase Ordering Rationale

- Dependencies are honored: contract -> primitive -> API exposure -> read paths -> write paths -> cleanup.
- Architecture boundaries stay stable: engine internals evolve while server/web/socket contracts remain fixed.
- Pitfall prevention is front-loaded: the most common failures are blocked before mutation-heavy migration work.

### Research Flags

Phases likely needing deeper `/gsd-research-phase` during planning:

- **Phase 5:** High integration risk around transform+wrap semantics, structure-key stability, and deterministic ordering under full engine load.
- **Phase 6 (only if `REF-05B` is in scope):** Cache-key design and invalidation need targeted perf research to avoid nondeterministic behavior.

Phases with standard patterns (can usually skip extra research):

- **Phase 1:** Contract-first parity harness pattern is well-established in this repo.
- **Phase 2:** Isolated immutable utility implementation with deterministic unit tests is straightforward.
- **Phase 3:** Adapter-first API migration is a known low-risk pattern.
- **Phase 4:** Read-path-first migration is documented and lower risk than mutation path changes.

## Confidence Assessment

| Area         | Confidence | Notes                                                                                             |
| ------------ | ---------- | ------------------------------------------------------------------------------------------------- |
| Stack        | HIGH       | Recommendations are repo-grounded and intentionally low-churn (no dependency additions).          |
| Features     | HIGH       | `REF-01`..`REF-05` are explicit, testable, and tightly scoped in milestone docs.                  |
| Architecture | HIGH       | Concrete component boundaries, data flow, and dependency-aware build order are already specified. |
| Pitfalls     | HIGH       | Risks are code-informed, phase-mapped, and paired with prevention + warning signals.              |

**Overall confidence:** HIGH

### Gaps to Address

- **`applyTransform` matrix scope:** confirm orthogonal integer-only acceptance for v0.0.3 to preserve determinism.
- **`StructureTemplate.grid` rollout:** decide when to make it mandatory in public type vs boundary-normalized transitional state.
- **Optional caching threshold:** define measurable profiling trigger before accepting `REF-05B`.
- **Structure key parity set:** lock fixture matrix proving unchanged key derivation across transformed placements.

## Sources

### Primary (HIGH confidence)

- `.planning/research/STACK.md` - stack constraints, versions, and integration points.
- `.planning/research/FEATURES.md` - `REF-01`..`REF-05` feature priorities, dependencies, anti-features.
- `.planning/research/ARCHITECTURE.md` - component boundaries, migration patterns, phased build order.
- `.planning/research/PITFALLS.md` - critical failure modes, prevention strategy, phase mapping.
- `.planning/PROJECT.md` - official v0.0.3 goal, requirements, and out-of-scope constraints.

### Secondary (MEDIUM confidence)

- `packages/rts-engine/rts.ts` - current authoritative geometry consumers and deterministic orchestration points.
- `packages/rts-engine/placement-transform.ts` and `packages/rts-engine/placement-transform.test.ts` - baseline transform semantics.
- `tests/integration/server/server.test.ts` and `tests/integration/server/quality-gate-loop.test.ts` - existing parity and deterministic guardrails.

### Tertiary (LOW confidence)

- None.

---

_Research completed: 2026-03-03_
_Ready for roadmap: yes_
