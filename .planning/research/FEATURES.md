# Feature Research

**Domain:** Conway RTS prototype - v0.0.3 Template/GridView refactor
**Researched:** 2026-03-03
**Confidence:** HIGH (based on current milestone scope plus shipped transform and integration behavior)

## Feature Landscape

### Table Stakes (Users Expect These)

These are must-haves for this cleanup milestone. Missing any of them means the refactor is incomplete or unsafe.

| Feature                                                                          | Why Expected                                                                                 | Complexity | Dependencies (Existing Systems)                                                                                                           | Notes (Concrete, Testable Behavior)                                                                                                                                                             |
| -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `REF-01` `template.grid()` canonical entrypoint                                  | The milestone goal is to stop branching between template and offset-template pathways        | MEDIUM     | `StructureTemplate` shape in `packages/rts-engine/rts.ts`; existing transform-aware placement flow                                        | `template.grid()` returns a transform-ready `GridView` anchored to template-local coordinates; repeated calls are behaviorally equivalent and do not mutate template source data                |
| `REF-02` `GridView.translate`, `GridView.rotate`, `GridView.applyTransform`      | Rotate/mirror placement is already shipped; refactor must preserve exact transform semantics | HIGH       | Shared helpers in `packages/rts-engine/placement-transform.ts`; existing preview/queue/apply parity and web transform controls            | `rotate()` applies 90-degree steps with four rotates returning identity; `applyTransform` stays order-sensitive; `translate(dx, dy)` applies signed offset without torus wrapping at this layer |
| `REF-03` `GridView.cells()` returns transformed `{ x, y, alive }` for every cell | Compare/apply/integrity logic needs complete transformed grids, not only occupied cells      | HIGH       | Existing compare/apply/integrity loops in `packages/rts-engine/rts.ts`; deterministic tick model                                          | `cells()` emits each transformed coordinate exactly once, includes `alive: 0` and `alive: 1`, and uses stable deterministic order (row-major by transformed `y`, then `x`)                      |
| `REF-04` deduplicate template vs offset-template logic with no outcome drift     | Main purpose of this milestone is simplification without gameplay behavior change            | HIGH       | Deterministic lifecycle ordering, authoritative queue validation taxonomy, reconnect-safe destroy projection, tactical overlay data feeds | For same input payloads, preview legality, rejection reason, queued outcome, applied footprint, and integrity effects remain unchanged versus baseline                                          |
| `REF-QUAL` parity safety net for refactor                                        | Internal cleanups need guardrails to prove no simulation or contract regressions             | MEDIUM     | Existing tests in `packages/rts-engine/*.test.ts`, `tests/integration/server/server.test.ts`, and transform view-model tests              | Add/keep assertions that old and new pathways are equivalent on transformed bounds, footprint cells, illegal cells, and rejection reasons                                                       |

### Differentiators (Optional but High Leverage)

These are optional improvements that increase maintainability and performance, but are not required for milestone closure.

| Feature                                                    | Value Proposition                                                               | Complexity | Dependencies (Existing Systems)                                      | Notes                                                                                                              |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------- | ---------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `REF-05A` Shared adapters for common GridView consumers    | Reduces repeated loops in compare/apply/integrity/build-zone projection code    | MEDIUM     | Core call sites in `packages/rts-engine/rts.ts`                      | Good candidate for the "additional low-risk simplification" requirement if diff stays small and tests remain green |
| `REF-05B` Lightweight transform projection caching         | Cuts repeated projection/allocation cost during rapid preview transform changes | MEDIUM     | Deterministic transform keying from operation sequence + translation | Only worthwhile if profiling shows hot paths; cache must be local and deterministic                                |
| `REF-05C` Temporary migration assertions (old vs new path) | Speeds verification while deleting duplicated code                              | LOW        | Existing unit/integration test harness                               | Keep during refactor, then remove once parity is locked and duplicate path is deleted                              |

### Anti-Features (Commonly Requested, Often Problematic)

| Feature                                                                             | Why Requested                                                 | Why Problematic                                                                          | Alternative                                                                                          |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| New transform types in this milestone (arbitrary-angle rotation, scaling, shearing) | "If we are touching transforms, add more transform power now" | Expands validation matrix and drift risk while cleanup work is trying to reduce risk     | Keep current transform scope only; consider expanded transforms in a separate milestone              |
| Client/runtime-specific transform forks                                             | "Frontend can compute faster locally"                         | Reintroduces cross-layer drift that v0.0.2 eliminated via shared transform utilities     | Keep transform math centralized in shared helpers and consume same semantics everywhere              |
| Mutable GridView/template APIs with in-place side effects                           | "Fewer allocations"                                           | Hidden mutation undermines deterministic reasoning and makes parity bugs hard to isolate | Keep GridView operations pure/chainable and leave wrapping/application to authoritative engine paths |
| Network contract churn during refactor                                              | "Clean up payloads while we refactor internals"               | High regression risk for server/web integration and reconnect-safe flows                 | Preserve existing payload shapes and reason taxonomy; refactor internals only                        |
| Broad unrelated cleanup bundled into v0.0.3                                         | "Touch nearby files while we're here"                         | Increases review surface and makes behavior regressions harder to attribute              | Limit scope to template/grid unification plus one explicitly scoped low-risk simplification          |

## Feature Dependencies

```text
[placement-transform.ts shared math]
    └──requires──> [REF-02 GridView transform APIs]
                        └──requires──> [REF-03 GridView.cells deterministic transformed output]
                                             └──required-by──> [preview/queue/apply + integrity + overlay parity]

[REF-01 template.grid canonical entrypoint]
    └──required-by──> [REF-04 remove template/offset-template duplication]
                         └──must-preserve──> [deterministic lifecycle + authoritative queue validation + reconnect-safe destroy]

[REF-QUAL parity tests]
    └──gates──> [REF-05 optional simplifications]
```

### Dependency Notes

- **`REF-02` depends on existing transform semantics:** operation order, rotate cycle behavior, and matrix normalization must match current authoritative placement behavior.
- **`REF-03` is the bridge between refactor and gameplay safety:** if `cells()` order/content drifts, compare/apply/integrity outcomes can change even when APIs compile.
- **`REF-04` depends on baseline invariants already shipped:** deterministic tick order and queue taxonomy must not be altered by cleanup.
- **Destroy and overlays are indirect dependencies:** stable structure projection data is needed so reconnect-safe destroy UI and tactical overlays remain trustworthy.
- **`REF-05` should ship only behind parity evidence:** do not merge optional simplification work without explicit regression coverage.

## MVP Definition

### Launch With (v0.0.3)

- [ ] `REF-01` `template.grid()` available as canonical transformable shape entrypoint
- [ ] `REF-02` `GridView.translate/rotate/applyTransform` implemented via shared transform helpers
- [ ] `REF-03` `GridView.cells()` yields deterministic transformed `{ x, y, alive }` entries for all cells
- [ ] `REF-04` duplicate template/offset-template paths removed with no authoritative behavior drift
- [ ] `REF-QUAL` regression tests proving preview/queue/apply/integrity parity

### Add After Validation (v0.0.3.x)

- [ ] `REF-05A` central helper extraction for repeated GridView consumer loops after parity lock
- [ ] `REF-05B` targeted caching if profiling shows transform projection hotspots
- [ ] Remove temporary migration assertions once duplicate pathway deletion is complete

### Future Consideration (v0.0.4+)

- [ ] Expanded transform model (only if gameplay requirements demand it)
- [ ] Template authoring/editor capabilities (separate product scope, not cleanup scope)

## Feature Prioritization Matrix

| Feature                                                  | User Value | Implementation Cost | Priority |
| -------------------------------------------------------- | ---------- | ------------------- | -------- |
| `REF-01` `template.grid()` canonical entrypoint          | HIGH       | MEDIUM              | P1       |
| `REF-02` GridView transform APIs via shared helpers      | HIGH       | HIGH                | P1       |
| `REF-03` deterministic transformed `cells()` output      | HIGH       | HIGH                | P1       |
| `REF-04` duplicate path removal without behavior changes | HIGH       | HIGH                | P1       |
| `REF-QUAL` parity regression coverage                    | HIGH       | MEDIUM              | P1       |
| `REF-05A` shared helper extraction                       | MEDIUM     | MEDIUM              | P2       |
| `REF-05B` transform projection caching                   | MEDIUM     | MEDIUM              | P2       |
| Transform model expansion in same milestone              | LOW        | HIGH                | P3       |

**Priority key:**

- P1: Must have for v0.0.3 milestone closure
- P2: Optional improvement after parity is proven
- P3: Explicitly deferred anti-feature for this milestone

## Implementation Pattern Analysis

| Feature Area          | Existing Path A                                   | Existing Path B                            | Our Approach                                                            |
| --------------------- | ------------------------------------------------- | ------------------------------------------ | ----------------------------------------------------------------------- |
| Template shape access | Direct template cell loops in multiple call sites | Offset-template style pathway duplication  | One `template.grid()` entrypoint consumed across call sites             |
| Transform application | Per-call projection + ad-hoc usage                | Separate branches for offset handling      | Shared GridView transform operations backed by shared transform helpers |
| Cell iteration        | Different loops for compare/apply/integrity       | Potentially different ordering assumptions | Single deterministic `GridView.cells()` contract reused everywhere      |

## Sources

- `/home/alpine/crts-opencode/.planning/PROJECT.md` (HIGH)
- `/home/alpine/crts-opencode/.planning/MILESTONES.md` (HIGH)
- `/home/alpine/crts-opencode/packages/rts-engine/placement-transform.ts` (HIGH)
- `/home/alpine/crts-opencode/packages/rts-engine/placement-transform.test.ts` (HIGH)
- `/home/alpine/crts-opencode/packages/rts-engine/rts.ts` (HIGH)
- `/home/alpine/crts-opencode/tests/integration/server/server.test.ts` (HIGH)

---

_Feature research for: Conway RTS prototype - v0.0.3 Template/GridView refactor_
_Researched: 2026-03-03_
