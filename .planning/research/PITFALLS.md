# Pitfalls Research

**Domain:** Deterministic multiplayer Conway RTS milestone v0.0.2 gameplay expansion
**Researched:** 2026-03-01
**Confidence:** HIGH

## Assumed Mitigation Phases (for placement guidance)

1. **Phase 1 - Contract and deterministic rule freeze**
2. **Phase 2 - Integrity generalization + 5x5 base/breach rebalance**
3. **Phase 3 - Union build-zone + transform-aware placement validation**
4. **Phase 4 - Destroy interactions + structure lifecycle cohesion**
5. **Phase 5 - UI architecture split + explicit lobby/in-game screen state**
6. **Phase 6 - Camera pan/zoom + overlays + interaction hardening**
7. **Phase 7 - Quality-gate expansion (unit/integration/replay/perf)**

## Critical Pitfalls

### Pitfall 1: Tick-order drift while generalizing periodic integrity checks

**What goes wrong:**
Template-wide integrity and HP repair are introduced in multiple places, and the same input sequence no longer resolves to the same tick-by-tick outcomes.

**Why it happens:**
Current behavior is tightly ordered (`applyTeamEconomyAndQueue -> applyTemplate -> stepGrid -> resolveCoreRestoreChecks`). Expanding checks from core-only to all structures invites ad hoc checks during queue validation, preview probes, or UI hooks.

**How to avoid:**
Define one authoritative integrity phase in engine code and run it once per tick in a deterministic order (teamId asc, then stable structure ordering). Keep all HP/repair writes inside that phase only.

**Warning signs:**
Same scripted match yields different defeat tick; intermittent failures in outcome/comparator tests; timeline event ordering differs between runs.

**Phase to address:**
Phase 1 (rule freeze) and Phase 2 (engine implementation).

---

### Pitfall 2: Hidden 2x2 base assumptions survive the 5x5 geometry migration

**What goes wrong:**
Placement validation, spawn spacing, breach checks, or UI markers still behave as if the base is a 2x2 block, creating unfair pressure and contradictory validation.

**Why it happens:**
The code currently hardcodes 2x2 assumptions in multiple places (`BASE_BLOCK_WIDTH/HEIGHT`, `baseTopLeft + 1` center math, spawn min distance, core checks).

**How to avoid:**
Introduce a single `BaseGeometry` model (footprint cells, center, check cells, bounding box) and replace all magic offsets/constants with geometry-derived helpers.

**Warning signs:**
"Outside territory" near expected legal base-adjacent cells; spawn overlap regressions; base hover/marker offset from actual vulnerable cells.

**Phase to address:**
Phase 2.

---

### Pitfall 3: Breach-pressure rebalance done by constant tweaking without deterministic scenarios

**What goes wrong:**
The new base shape plus repair loop produces degenerate matches (snowball in <30s, or stalemates that rarely finish).

**Why it happens:**
Balance changes are validated only with ad hoc playtests instead of replayable scripted pressure cases.

**How to avoid:**
Create deterministic scenario fixtures (mirrored openings, sustained pressure windows, repeated breach attempts) and set numeric acceptance bands for match duration and comeback frequency.

**Warning signs:**
Match duration distribution collapses to extremes; one opening dominates win rate; repeated unresolved matches in integration smoke runs.

**Phase to address:**
Phase 2 (initial tuning) and Phase 7 (regression gate).

---

### Pitfall 4: Union build-zone logic diverges between preview, queue, and UI

**What goes wrong:**
Client preview says placement is valid, queue rejects it (or inverse), especially after structure activation/deactivation.

**Why it happens:**
Current validation is radius-based around base center. Migrating to union-of-structure zones can leave mixed logic paths if only one call site is updated.

**How to avoid:**
Use one engine helper for eligibility (`isPlacementBuildEligible`) and route both preview probes and queue validation through that exact helper. Drive overlays from authoritative state, not separate client math.

**Warning signs:**
Spike in `outside-territory` rejections immediately after green/affordable previews; user reports "overlay says yes, server says no".

**Phase to address:**
Phase 3.

---

### Pitfall 5: Rotate/mirror transforms are implemented twice and disagree

**What goes wrong:**
A placement accepted by client preview applies shifted/rotated differently on the server, causing reject noise and trust loss.

**Why it happens:**
Transform math (pivot, anchor, even/odd footprint handling) is duplicated in client rendering and server validation.

**How to avoid:**
Implement transforms once in shared package code and reuse on both server and web. Add golden fixtures for all transform states against known templates (including asymmetric templates).

**Warning signs:**
Orientation-specific rejects (`out-of-bounds`/`occupied-site`) for otherwise valid clicks; applied shape appears one cell off from ghost.

**Phase to address:**
Phase 3 (shared math) and Phase 6 (UI consumption).

---

### Pitfall 6: Structure identity collisions under transform + destroy

**What goes wrong:**
Destroy requests target the wrong structure or fail to target any structure after rotation/mirroring, especially for templates sharing width/height anchors.

**Why it happens:**
Current structure keying is anchor+dimensions. That is not robust once transform state and lifecycle actions are first-class.

**How to avoid:**
Give every placed structure a stable `structureId` (event-derived), persist transform metadata, and resolve destroy actions by ID plus ownership checks.

**Warning signs:**
Destroy action removes neighbor structure; `occupied-site` conflicts on apparently empty anchors; timeline metadata references non-existent keys.

**Phase to address:**
Phase 3 (identity model) and Phase 4 (destroy flows).

---

### Pitfall 7: Destroy interactions bypass queue-validation and lifecycle gates

**What goes wrong:**
Immediate destroy mutations race with queued builds and defeat resolution, creating non-deterministic state and broken outcome accounting.

**Why it happens:**
Destroy is treated as a direct UI action instead of a queued, server-authoritative gameplay mutation.

**How to avoid:**
Model destroy as queued intent with execute tick, terminal outcome, and explicit reasons (`unknown-structure`, `not-owner`, `core-locked`, `team-defeated`). Enforce the same mutation gate used by build queue.

**Warning signs:**
Build outcomes reference structures that no longer exist; different clients disagree on structure presence; defeated players can still issue destroy actions.

**Phase to address:**
Phase 4.

---

### Pitfall 8: Derived state (income/build-zone/hover data) lags after destroy or repair

**What goes wrong:**
Income, build-zone eligibility, and hover status reflect stale pre-destroy/pre-repair values for one or more ticks.

**Why it happens:**
Derived values are recalculated in scattered places, and new lifecycle transitions add more invalidation points.

**How to avoid:**
Centralize all derived-state recomputation in one post-mutation pass per tick. Tie previews to that pass, and include versioned derived-state metadata for UI invalidation.

**Warning signs:**
Income does not drop after destroy; overlay still shows removed structure influence; hover HP/status disagrees with latest state payload.

**Phase to address:**
Phase 4 (engine) and Phase 6 (UI sync behavior).

---

### Pitfall 9: Pan/zoom + UI refactor breaks coordinate mapping and multiplies event handlers

**What goes wrong:**
Clicks target wrong cells at non-default zoom, or one input emits multiple preview/queue events due duplicate listeners after screen transitions.

**Why it happens:**
Current pointer mapping assumes no camera transform, and `client.ts` is monolithic with many side effects tied directly to DOM/socket events.

**How to avoid:**
Introduce explicit camera state with inverse coordinate mapping, and split UI into mount/unmount-safe modules with one-time socket registration and explicit screen FSM.

**Warning signs:**
Cursor-to-cell drift increases with zoom; duplicate queue acks from one click; frame drops when overlays are enabled during active tick updates.

**Phase to address:**
Phase 5 (architecture split) and Phase 6 (camera/overlay interactions).

---

### Pitfall 10: Event-contract drift for new fields (transform, destroy, structure status)

**What goes wrong:**
Server, client, and tests compile independently but disagree at runtime on payload shape/reason enums, causing silent fallback copy and wrong UX.

**Why it happens:**
New fields are appended ad hoc in handlers before shared contract/types and integration assertions are updated.

**How to avoid:**
Update `socket-contract.ts` first, then server/client handlers, then integration tests. Keep reason codes union-typed and ban catch-all reason mapping for new gameplay events.

**Warning signs:**
UI falls back to generic "validation failed" text for new rejection paths; integration tests fail on undefined payload fields.

**Phase to address:**
Phase 1 (contract-first) and Phase 7 (quality gate enforcement).

---

## Technical Debt Patterns

Shortcuts that look fast now but create costly rewrites in this milestone.

| Shortcut                                                               | Immediate Benefit                 | Long-term Cost                                           | When Acceptable                |
| ---------------------------------------------------------------------- | --------------------------------- | -------------------------------------------------------- | ------------------------------ |
| Keep scalar `territoryRadius` logic and fake union zones only in UI    | Faster demo of build-zone feature | Preview/queue mismatch and fairness bugs                 | Never                          |
| Implement rotate/mirror math separately in client and server           | Faster local iteration per layer  | Persistent offset/rejection bugs that are hard to debug  | Never                          |
| Reuse anchor-based structure key as destroy target                     | Minimal schema changes            | Wrong-target destroy and key collisions under transforms | Never                          |
| Add pan/zoom directly into monolithic `client.ts` without module split | Fast feature spike                | Listener leaks, state coupling, transition regressions   | Only as throwaway spike branch |
| Tune breach constants from ad hoc playtests only                       | Immediate balance tweaks          | Rebalance churn with no deterministic baseline           | Never for milestone closure    |

## Integration Gotchas

| Integration                        | Common Mistake                                          | Correct Approach                                                       |
| ---------------------------------- | ------------------------------------------------------- | ---------------------------------------------------------------------- |
| `rts-engine` <-> server build APIs | Update queue path but not preview probe path            | Keep preview and queue on same engine validator and transform helpers  |
| server <-> web placement payloads  | Add transform fields in one direction only              | Extend shared socket contract first, then both emit/listen paths       |
| destroy action <-> lifecycle gate  | Allow destroy during lobby/finished or for spectators   | Reuse gameplay mutation gate and room status checks                    |
| state payload <-> overlays         | Compute overlay zones from client-local estimates       | Render overlays from authoritative payload and shared geometry helpers |
| tests <-> runtime event reasons    | Keep generic string assertions after adding new reasons | Assert exact typed reason unions and terminal outcomes                 |

## Performance Traps

| Trap                                                                 | Symptoms                                  | Prevention                                                                       | When It Breaks                                       |
| -------------------------------------------------------------------- | ----------------------------------------- | -------------------------------------------------------------------------------- | ---------------------------------------------------- |
| Recomputing union build zones from scratch every tick                | Tick duration climbs with structure count | Incremental invalidation keyed by structure lifecycle changes                    | Mid-size rooms with many active structures           |
| Running `structuredClone` preview probes at pointermove frequency    | CPU spikes and delayed preview feedback   | Throttle preview emits per tick and cache unchanged placement results            | During rapid placement scanning at active tick rates |
| Full canvas resize + full redraw every `state` while adding pan/zoom | Frame drops and input lag                 | Resize on dimension change only, draw on animation frame, apply camera transform | Larger maps with overlays enabled                    |
| Hover detail lookups scanning all structures per move                | UI stutter while panning/hovering         | Spatial index or cell-to-structure map updated per tick                          | Dense late-game structure fields                     |

## Security Mistakes

| Mistake                                       | Risk                                           | Prevention                                                          |
| --------------------------------------------- | ---------------------------------------------- | ------------------------------------------------------------------- |
| Destroy payload lacks strict ownership checks | Cross-team griefing via forged structure IDs   | Validate team ownership and room membership before queueing destroy |
| Transform payload accepts arbitrary values    | Invalid states or parser abuse paths           | Restrict transform to strict enum and reject unknown values         |
| No rate limit on preview/destroy spam         | Event flood starves tick and UI responsiveness | Per-socket throttles and bounded pending intent queues              |

## UX Pitfalls

| Pitfall                                                  | User Impact                                     | Better Approach                                                       |
| -------------------------------------------------------- | ----------------------------------------------- | --------------------------------------------------------------------- |
| Ghost placement orientation does not match applied shape | Players lose trust in controls                  | Render ghost using server-shared transform helpers                    |
| Overlay shows eligible area that server rejects          | Feels random and unfair                         | Drive overlay from authoritative zone model/versioned state           |
| Destroy action has no clear terminal feedback            | Users think command was ignored                 | Show queued -> applied/rejected lifecycle for destroy intents         |
| Lobby/in-game transition keeps stale build selection     | Accidental invalid queues after screen switches | Reset interaction state on screen transitions with explicit FSM hooks |

## "Looks Done But Isn't" Checklist

- [ ] **Integrity generalization:** All templates checked, but tick order changed - verify deterministic replay snapshots still match expected timeline.
- [ ] **Base migration:** Visual 5x5 shape added - verify spawn spacing, center math, and breach checks are geometry-driven (no hardcoded +1 center assumptions).
- [ ] **Union zones:** Overlay renders union - verify preview and queue use the same server validator and produce no contradictory outcomes.
- [ ] **Transforms:** Rotate/mirror UI works - verify all transform states apply identically server-side with no orientation-specific offset.
- [ ] **Destroy flow:** Button removes structure in UI - verify destroy is queue-validated with terminal outcomes and defeat/lifecycle gating.
- [ ] **Pan/zoom overlays:** Camera feels good - verify pointer-to-cell correctness at multiple zoom levels and no duplicate event emissions after transitions.
- [ ] **Quality gates:** New features pass unit tests - verify integration scenarios cover cross-client deterministic outcomes and rejection reasons.

## Recovery Strategies

| Pitfall                                        | Recovery Cost | Recovery Steps                                                                                                        |
| ---------------------------------------------- | ------------- | --------------------------------------------------------------------------------------------------------------------- |
| Tick-order drift in integrity/repair           | HIGH          | Revert to last deterministic tick order, add replay fixtures, reintroduce generalized checks behind one ordered phase |
| 5x5 base migration with hidden 2x2 assumptions | HIGH          | Introduce explicit geometry model, migrate all call sites, re-baseline spawn/territory/breach tests                   |
| Transform mismatch across client/server        | MEDIUM        | Centralize transform helper in shared package, update both layers, add golden transform fixtures                      |
| Destroy bypass path shipped                    | HIGH          | Disable direct destroy endpoint, route through queued flow, backfill terminal outcome and ownership checks            |
| UI camera/refactor regressions                 | MEDIUM        | Roll back to stable interaction controller, add mount/unmount listener guardrails, re-enable pan/zoom incrementally   |

## Pitfall-to-Phase Mapping

| Pitfall                                          | Prevention Phase   | Verification                                                                                  |
| ------------------------------------------------ | ------------------ | --------------------------------------------------------------------------------------------- |
| Tick-order drift during integrity generalization | Phase 1 -> Phase 2 | Deterministic replay suite reproduces identical timeline and defeat ticks                     |
| Hidden 2x2 assumptions after base migration      | Phase 2            | Geometry invariants pass for spawn, territory checks, and breach detection                    |
| Breach-pressure rebalance without scenarios      | Phase 2 -> Phase 7 | Scenario-based duration/comeback metrics remain inside defined acceptance bands               |
| Union zone divergence (preview vs queue vs UI)   | Phase 3            | Integration tests show zero contradictory preview/queue outcomes for sampled placements       |
| Transform math divergence                        | Phase 3 -> Phase 6 | Golden fixtures and E2E placement tests pass for all transform states                         |
| Structure identity collisions under destroy      | Phase 3 -> Phase 4 | Destroy-by-ID tests remove only intended structure across transform variants                  |
| Destroy bypassing deterministic queue            | Phase 4            | Every destroy intent resolves with terminal outcome and lifecycle gate compliance             |
| Stale derived state after lifecycle changes      | Phase 4 -> Phase 6 | Income/zone/hover values update coherently within same tick payload                           |
| Pan/zoom + transition interaction regressions    | Phase 5 -> Phase 6 | Pointer mapping tests pass at varied zoom; no duplicate event emissions after screen switches |
| Event contract drift for new fields/reasons      | Phase 1 -> Phase 7 | Shared contract types compile across layers and integration asserts full payload shape        |

## Sources

- [HIGH] Milestone scope and constraints: `.planning/PROJECT.md`.
- [HIGH] Original domain mechanics and intended UI controls: `conway-rts/DESIGN.md`.
- [HIGH] Engine invariants and current tick order: `packages/rts-engine/rts.ts`.
- [HIGH] Shared event contract surface: `packages/rts-engine/socket-contract.ts`.
- [HIGH] Runtime lifecycle/mutation gates and preview/queue wiring: `apps/server/src/server.ts`.
- [HIGH] Current UI interaction model (pointer mapping, rendering, transitions): `apps/web/src/client.ts`.
- [HIGH] Existing unit coverage boundaries: `packages/rts-engine/rts.test.ts`.
- [HIGH] Existing integration coverage boundaries: `tests/integration/server/server.test.ts`, `tests/integration/server/quality-gate-loop.test.ts`, `tests/integration/server/match-lifecycle.test.ts`.
- [MEDIUM] Prior concern inventory for fragile areas and coverage gaps: `.planning/codebase/CONCERNS.md` (dated 2026-02-27; partially stale, used only as secondary corroboration).

---

_Pitfalls research for: Conway RTS v0.0.2 Gameplay Expansion_
_Researched: 2026-03-01_
