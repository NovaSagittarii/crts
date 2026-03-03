# Pitfalls Research

**Domain:** Conway RTS v0.0.3 template/grid API unification (`template.grid()` + `GridView`)
**Researched:** 2026-03-03
**Confidence:** HIGH

## Assumed Mitigation Phases (for roadmap placement)

1. **Phase 13 - GridView contract freeze and parity harness**
2. **Phase 14 - GridView core implementation (`translate`/`rotate`/`applyTransform`/`cells`)**
3. **Phase 15 - Engine migration (`preview`/`queue`/`apply`/integrity/build-zone)**
4. **Phase 16 - Runtime integration (server/web/test contract alignment)**
5. **Phase 17 - Legacy-path deletion, deterministic hardening, and perf guardrails**

## Critical Pitfalls

### Pitfall 1: `GridView.cells()` drops dead cells or emits duplicate coordinates

**What goes wrong:**
Build compare/apply logic silently changes because only alive cells are iterated (or the same transformed coordinate is emitted twice). This changes resource cost (`diffCells`), placement outcomes, and integrity behavior.

**Why it happens:**
Developers optimize for footprint rendering and accidentally implement sparse iteration, but the engine currently relies on full-grid comparisons (`compareTemplate`) and full writes (`applyTemplate`).

**How to avoid:**
Lock `cells()` contract in Phase 13: emit exactly `width * height` entries, each coordinate exactly once, with `alive` as `0/1`. Add a deterministic row-major ordering rule (`y`, then `x`) and enforce it with unit tests before migration.

**Warning signs:**

- Build costs become lower/higher than baseline for identical placements.
- Applied templates leave stale cells behind after supposedly dead template cells.
- Preview/queue parity tests pass for footprint-only checks but fail on execute-time outcomes.

**Phase to address:**
Phase 13 and Phase 14.

---

### Pitfall 2: Transform semantics drift from existing authoritative math

**What goes wrong:**
`rotate`/`applyTransform` in `GridView` produce different bounds or coordinates than `projectTemplateWithTransform`, causing transform-specific rejects, shifted footprints, or changed `template-exceeds-map-size` behavior.

**Why it happens:**
Refactor reimplements matrix composition or pivot semantics instead of delegating to existing shared transform helpers.

**How to avoid:**
Make `GridView` a thin API over `normalizePlacementTransform` + `projectTemplateWithTransform` semantics. Reuse existing transform fixtures (including asymmetric templates) and add equivalence tests old-path vs new-path for all operation sequences used by runtime.

**Warning signs:**

- Rotated placement passes preview but rejects on queue/execute.
- Four rotates no longer return to identity shape.
- Integration case "rejected queue preview refreshes with same transform" starts failing.

**Phase to address:**
Phase 14.

---

### Pitfall 3: Local transform translation gets mixed with world wrapping

**What goes wrong:**
Placements near edges shift or wrap incorrectly because translation is applied in world space too early, or wrap occurs inside `GridView` instead of projection-to-world.

**Why it happens:**
`GridView.translate` and placement projection concerns are mixed into one method during unification.

**How to avoid:**
Keep `GridView` purely in template-local integer space. Apply torus wrapping only at projection stage (`projectPlacementToWorld`-equivalent). Add edge-anchor parity fixtures (`x=width-1`, `y=height-1`, negative translation) against baseline behavior.

**Warning signs:**

- Edge placements show one-cell drift in preview overlays.
- Wrapped footprints differ between `previewBuildPlacement` and `tickRoom` apply.
- `outside-territory` spikes near map seams only.

**Phase to address:**
Phase 14 and Phase 15.

---

### Pitfall 4: Mutable `GridView` aliasing leaks transform state across calls

**What goes wrong:**
Calling `rotate()` or `translate()` on one flow mutates shared view state used by another flow, creating order-dependent bugs and flaky deterministic tests.

**Why it happens:**
In-place mutation seems cheaper during refactor, and `template.grid()` may accidentally return a cached mutable instance.

**How to avoid:**
Keep `GridView` immutable: operations return a new view, and `template.grid()` returns a fresh equivalent view each call. Add tests that call `template.grid()` repeatedly in different orders and verify identical outputs.

**Warning signs:**

- Running tests in different order changes outcomes.
- A "default orientation" preview appears transformed after a prior rotated preview.
- Intermittent transform-related flakes without code changes.

**Phase to address:**
Phase 13 and Phase 14.

---

### Pitfall 5: Partial migration leaves preview/queue/apply/integrity on different geometry paths

**What goes wrong:**
Preview uses `GridView`, but queue execution or integrity checks still use legacy loops, so authoritative outcomes diverge from what users see.

**Why it happens:**
Refactor is applied incrementally per call site without a migration gate or parity harness.

**How to avoid:**
Plan migration as one engine slice: switch all geometry consumers (`compareTemplate`, `applyTemplate`, integrity mask extraction, structure projection) to the same adapter in Phase 15. Keep dual-path parity assertions temporarily, then delete the legacy path in Phase 17.

**Warning signs:**

- Queue accepted after preview but rejected/applied differently at execute tick with no intervening state change.
- Build outcomes reason taxonomy shifts unexpectedly.
- Overlay/footprint metadata differs from applied structure footprint.

**Phase to address:**
Phase 15 and Phase 17.

---

### Pitfall 6: Deterministic ordering regresses due unstable cell iteration

**What goes wrong:**
Equal input sequences produce different timeline ordering or end states across runs because transformed cells/checks are emitted in non-stable order.

**Why it happens:**
Use of insertion-order containers without explicit sorting, or sort criteria changes during unification.

**How to avoid:**
Define and enforce ordering invariants: `GridView.cells()` sorted by transformed `y,x`; transformed checks sorted similarly; existing team/structure ordering (`teamId`, `structure.key`) unchanged. Add twin-run determinism assertions for outcomes and packed grid payload.

**Warning signs:**

- Determinism tests (`equal-run` style) become flaky.
- Same scripted queue produces different timeline event sequences.
- Snapshot diffs show reordered but semantically "similar" arrays.

**Phase to address:**
Phase 15 and Phase 17.

---

### Pitfall 7: Structure key derivation changes unintentionally under new bounds source

**What goes wrong:**
`createStructureKey(x,y,width,height)` yields different keys for the same effective placement, breaking destroy targeting and occupancy checks.

**Why it happens:**
Width/height or anchor semantics drift when bounds start coming from `GridView` instead of legacy transformed-template code.

**How to avoid:**
Freeze key derivation semantics before migration and assert key stability on a transform matrix of placements. During Phase 15, compare old/new key output for baseline fixtures before switching producer code.

**Warning signs:**

- `occupied-site` rejects appear for apparently empty anchors.
- Destroy requests return `invalid-target` for just-placed structures.
- Pending destroy rows reference keys not found in `team.structures`.

**Phase to address:**
Phase 15 and Phase 16.

---

### Pitfall 8: Contract and test harness drift masks cross-runtime regressions

**What goes wrong:**
Server, web, and tests all compile, but runtime behavior diverges because tests still use approximate local transform helpers (instead of canonical engine view/projection semantics) and contract assertions are too loose.

**Why it happens:**
Refactor is treated as "internal only" and integration tests are not tightened to assert transformed payload parity and reason stability.

**How to avoid:**
In Phase 16, route integration helpers to shared engine semantics where possible; otherwise add explicit parity assertions for `transform`, `bounds`, `footprint`, and rejection reasons. In Phase 17, keep requirement-traceable deterministic gates (`test:unit`, `test:integration:serial`, `test:quality`) as merge blockers.

**Warning signs:**

- Unit tests green but integration tests fail on payload details.
- Preview overlay looks correct while queue/apply outcomes drift.
- Refactor PR requires ad hoc test updates with relaxed assertions.

**Phase to address:**
Phase 16 and Phase 17.

---

## Technical Debt Patterns

Shortcuts that seem fast for this refactor but create expensive follow-up work.

| Shortcut                                              | Immediate Benefit          | Long-term Cost                                 | When Acceptable                                               |
| ----------------------------------------------------- | -------------------------- | ---------------------------------------------- | ------------------------------------------------------------- |
| Keep both legacy and `GridView` pathways indefinitely | Easier incremental merge   | Permanent drift risk and doubled maintenance   | Never beyond temporary parity assertions in one PR            |
| Reimplement transform math inside `GridView`          | Faster local coding        | Semantics drift from authoritative helpers     | Never                                                         |
| Return mutable `GridView` for performance             | Fewer allocations          | Order-dependent bugs and flaky determinism     | Never                                                         |
| Relax integration assertions to "any rejection"       | Quick green pipeline       | Hides reason taxonomy regressions and UX drift | Never                                                         |
| Bundle unrelated cleanup in same milestone            | Single large refactor pass | Harder rollback/root-cause isolation           | Only if change is test-backed and strictly no behavior impact |

## Integration Gotchas

| Integration Boundary                                         | Common Mistake                                                           | Correct Approach                                                             |
| ------------------------------------------------------------ | ------------------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| `packages/rts-engine/rts.ts` compare/apply/integrity         | Migrate one consumer to `GridView` and leave others on legacy loops      | Switch all geometry consumers behind one adapter in same phase               |
| `apps/server/src/server.ts` preview payload construction     | Assume fallback bounds/transform hide internal drift                     | Assert returned `transform`, `bounds`, `footprint` parity from engine output |
| `apps/web/src/client.ts` overlay rendering                   | Render from local assumptions instead of authoritative preview payload   | Keep preview overlays sourced from server `build:preview` payload only       |
| `tests/integration/server/quality-gate-loop.test.ts` helpers | Keep ad hoc `estimateTransformedTemplateSize` assumptions after refactor | Replace/augment with canonical engine-based parity checks                    |
| `packages/rts-engine/socket-contract.ts` usage in tests/web  | Allow broad string reasons and partial payload assertions                | Assert exact reason unions and transformed payload fields                    |

## Performance Traps

| Trap                                                                         | Symptoms                           | Prevention                                                                            | When It Breaks                                     |
| ---------------------------------------------------------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------- | -------------------------------------------------- |
| Recomputing transformed cells for unchanged selection on every preview pulse | CPU spikes while rotating/hovering | Cache per `(templateId, transform.operations, translate)` within request scope        | Rapid transform toggling and dense preview traffic |
| Materializing full `cells()` arrays repeatedly in one tick path              | Higher tick latency and GC churn   | Use streaming iteration where possible; avoid duplicate transformations per call site | Late-game with many active structures              |
| Keeping dual-path parity checks in production code                           | Tick overhead after migration      | Restrict parity checks to tests/dev builds; remove in Phase 17                        | Any non-trivial room size                          |
| Debug logging every transformed cell                                         | Frame/tick stutter and giant logs  | Log aggregate stats only (counts, bounds, hash)                                       | Integration load tests and CI                      |

## Security Mistakes

| Mistake                                                            | Risk                                                       | Prevention                                                                  |
| ------------------------------------------------------------------ | ---------------------------------------------------------- | --------------------------------------------------------------------------- |
| Accept unbounded transform operation arrays at runtime boundaries  | CPU amplification via large payload parsing/projection     | Keep strict enum validation and cap operation count at boundary parser      |
| Expose new transform primitives over wire during internal refactor | Expanded attack/abuse surface without requirement need     | Keep refactor internal; do not change public payload schema unless required |
| Add debug toggles that switch legacy/new paths from client payload | Behavior tampering and inconsistent authoritative outcomes | Keep migration toggles server-internal and test-only                        |

## UX Pitfalls

| Pitfall                                                     | User Impact                                       | Better Approach                                                               |
| ----------------------------------------------------------- | ------------------------------------------------- | ----------------------------------------------------------------------------- |
| Preview ghost orientation does not match applied structure  | Loss of trust in controls                         | Assert preview->queue->apply parity for each transform operation sequence     |
| Edge placement ghost wraps differently than applied outcome | "Random" rejections near borders                  | Keep wrap logic in one projection stage and test seam anchors                 |
| Rejection copy changes taxonomy after refactor              | Users cannot act on errors                        | Preserve existing reason unions and mapping copy during cleanup milestone     |
| Overlay highlights stale legality after transform change    | Players queue invalid actions despite green hints | Refresh authoritative preview on transform revision and reject stale previews |

## "Looks Done But Isn't" Checklist

- [ ] **`GridView.cells()` contract:** Verify every transformed coordinate is emitted exactly once with `alive` values for full grid, not only footprint.
- [ ] **Transform equivalence:** Verify `GridView.rotate/applyTransform` outputs match existing `projectTemplateWithTransform` fixtures.
- [ ] **Wrap semantics:** Verify seam placements produce identical `bounds`, `footprint`, and legality before/after refactor.
- [ ] **Engine path unification:** Verify preview, queue, apply, and integrity all use the same geometry source.
- [ ] **Structure key stability:** Verify transformed placement keys remain stable for destroy and occupied-site checks.
- [ ] **Cross-runtime parity:** Verify server `build:preview` payload still matches web overlay expectations and integration assertions.
- [ ] **Determinism:** Verify twin-run scripts produce identical `buildOutcomes`, `destroyOutcomes`, timeline ordering, and packed grid payload.
- [ ] **Legacy cleanup:** Verify old template/offset-template path is fully removed (no dead code fallback).

## Recovery Strategies

| Pitfall                            | Recovery Cost | Recovery Steps                                                                                                             |
| ---------------------------------- | ------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `cells()` completeness/order drift | HIGH          | Revert to baseline adapter, lock contract tests (`count`, uniqueness, order), then re-enable migration by one engine slice |
| Transform semantic mismatch        | HIGH          | Route `GridView` methods through existing transform helpers, replay fixture matrix, re-baseline overflow/reject tests      |
| Preview/queue/apply divergence     | HIGH          | Introduce temporary dual-path assertion harness in tests, switch all call sites atomically, then remove legacy path        |
| Structure key drift                | MEDIUM        | Freeze legacy key snapshots, patch bounds derivation compatibility layer, backfill destroy/occupied-site regression tests  |
| Integration harness drift          | MEDIUM        | Replace ad hoc transform estimators with canonical engine projections and tighten payload/reason assertions                |

## Pitfall-to-Phase Mapping

| Pitfall                                       | Prevention Phase     | Verification                                                                                            |
| --------------------------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------- |
| `cells()` completeness/uniqueness/order drift | Phase 13 -> Phase 14 | Unit tests assert transformed cell count, uniqueness, and row-major ordering invariants                 |
| Transform semantic mismatch                   | Phase 14             | Golden fixture parity against existing placement-transform outputs                                      |
| Local/world coordinate and wrapping mix-up    | Phase 14 -> Phase 15 | Edge-anchor integration matrix passes for preview, queue, apply, and footprint overlays                 |
| Mutable `GridView` aliasing                   | Phase 13 -> Phase 14 | Repeated `template.grid()` calls remain order-independent and deterministic                             |
| Partial migration path divergence             | Phase 15 -> Phase 17 | Same input produces same preview reason, queue result, execute outcome, and final grid hash             |
| Deterministic ordering regression             | Phase 15 -> Phase 17 | Equal-run deterministic tests match timeline/order/outcomes exactly                                     |
| Structure key drift                           | Phase 15 -> Phase 16 | Destroy/occupied-site tests pass with unchanged key expectations across transforms                      |
| Contract/test drift                           | Phase 16 -> Phase 17 | `test:integration:serial` and `test:quality` assert full transformed payload parity and reason taxonomy |

## Sources

- [HIGH] `.planning/PROJECT.md` - v0.0.3 requirements (`REF-01`..`REF-05`) and hard constraints.
- [HIGH] `.planning/STATE.md` - continuous phase numbering and backend-first delivery model.
- [HIGH] `.planning/research/FEATURES.md` - explicit `GridView` contract targets and dependency framing.
- [HIGH] `packages/rts-engine/rts.ts` - current authoritative placement/compare/apply/integrity/queue behavior and deterministic tick order.
- [HIGH] `packages/rts-engine/placement-transform.ts` and `packages/rts-engine/placement-transform.test.ts` - current transform semantics to preserve.
- [HIGH] `packages/rts-engine/socket-contract.ts` - cross-runtime payload and rejection-reason contract surface.
- [HIGH] `apps/server/src/server.ts` - preview/queue wiring, payload parsing, and rejection propagation.
- [HIGH] `apps/web/src/client.ts` and `apps/web/src/placement-transform-view-model.ts` - authoritative preview consumption and transform UI behavior.
- [HIGH] `tests/integration/server/server.test.ts` and `tests/integration/server/quality-gate-loop.test.ts` - parity and deterministic integration guardrails.

---

_Pitfalls research for: Conway RTS v0.0.3 Template/GridView refactor_
_Researched: 2026-03-03_
