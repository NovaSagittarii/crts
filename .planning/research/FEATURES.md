# Feature Research

**Domain:** Conway RTS prototype - v0.0.2 Gameplay Expansion
**Researched:** 2026-03-01
**Confidence:** HIGH (milestone scope and behavior are defined in project docs)

## Feature Landscape

### Table Stakes (Users Expect These)

Features players should experience as baseline in v0.0.2. Missing these makes the gameplay expansion feel incomplete.

| Feature                                                         | Expected Player-Facing Behavior                                                                                                                   | Complexity | Dependencies (Existing Systems)                                                                                                    | Milestone Notes                                              |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `STRUCT-INT`: Template-wide integrity + HP repair loop          | Structures that fail integrity auto-restore on repair intervals by consuming structure HP; exhausted HP leads to predictable collapse/degradation | HIGH       | Deterministic tick simulation; structure HP/state model; authoritative state snapshots; unit/integration quality gates from v0.0.1 | Land backend + tests before rich UI for structure status     |
| `BASE-SHAPE`: 5x5 base footprint (16 cells)                     | Bases are easier to pressure and breach paths are broader, creating more active attack/defense play than a tiny core                              | MEDIUM     | Spawn/base initialization rules; breach/defeat resolution; client rendering for base geometry                                      | Keep one canonical 5x5 layout for this milestone             |
| `BUILD-ZONE`: Union of per-structure build zones (radius 15)    | Build eligibility expands or contracts from owned structures, replacing one global build radius with spatially meaningful pressure zones          | HIGH       | Existing build queue validation/rejection flow; structure ownership index; geometry helpers; affordability feedback loop           | Radius is fixed at 15 in v0.0.2 to avoid rebalance churn     |
| `UI-ARCH`: Lobby and in-game screen separation with transitions | Players move through a clear lobby flow into a focused in-game view with explicit state transitions at match start/end                            | MEDIUM     | Existing room/match lifecycle events and reconnect state; current web state machine                                                | Keep Socket.IO lobby contract stable while UI flow changes   |
| `UI-ARCH` enabler: UI modularization into focused files         | No direct new button, but players get fewer regressions while new controls/overlays ship and iterate                                              | MEDIUM     | Existing `apps/web/src/client.ts` responsibilities; build tooling and event wiring                                                 | Treat as mandatory delivery foundation, not optional cleanup |

### Differentiators (High-Value Gameplay/UI Leverage)

These features increase strategic expression and readability once table stakes are stable.

| Feature                                                           | Value Proposition                                                                                              | Complexity | Dependencies (Existing Systems)                                                                              | Milestone Notes                                                        |
| ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------- |
| `PLACE-XFORM`: Rotate/mirror placement transforms                 | Players can adapt the same template to many tactical contexts without requiring a much larger template catalog | HIGH       | Template placement pipeline; server-side build validation; client preview/ghost placement handling           | Ship canonical transforms only (90-degree rotations + mirror)          |
| `UI-MAP`: Structure hover details + destroy action                | Players can inspect ownership/health role and intentionally remove weak or misplaced structures                | MEDIUM     | Authoritative structure identifiers and metadata in snapshots; action validation and acknowledgment pipeline | Start with single-structure select + confirm destroy (no bulk actions) |
| `UI-MAP`: Pan/zoom camera + in-grid overlays (economy/build/team) | Larger base/build-zone mechanics stay readable and pressure is understandable at gameplay speed                | HIGH       | Camera/world coordinate transform layer; authoritative economy/team/build-zone data feeds; render layering   | Prioritize correctness and legibility over animation polish            |

### Anti-Features (Out of Scope / Risky Scope Expansion)

| Anti-Feature                                                 | Why Requested                                    | Why Problematic in v0.0.2                                                                                                  | Alternative                                                      |
| ------------------------------------------------------------ | ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Full custom template editor + user-uploaded template sharing | More creativity and content variety              | Expands validation surface, abuse risk, and balance volatility while core transform/build-zone rules are still stabilizing | Keep curated templates and ship rotate/mirror first              |
| Minimap, fog-of-war, cinematic camera effects                | Feels "more complete RTS"                        | High UI/system cost that competes with required pan/zoom + overlay correctness                                             | Deliver practical pan/zoom with clear, trustworthy overlays      |
| Bulk destroy, undo/redo timeline editing                     | Convenience for correcting mistakes              | Requires rollback/history semantics and increases deterministic desync risk                                                | Single destroy action with explicit server acknowledgment        |
| Multiple base archetypes or custom base geometry             | Variety/replayability request                    | Undercuts `BASE-SHAPE` balancing objective and multiplies breach test matrix                                               | Lock to one 5x5 (16-cell) base shape this milestone              |
| Frontend framework migration during modularization           | Team ergonomics and long-term architecture goals | High delivery risk and minimal immediate player value for this milestone                                                   | Modularize the current TypeScript/Vite client incrementally      |
| Client-predicted build-zone/repair outcomes                  | Faster apparent responsiveness                   | Risks divergence from authoritative simulation and confusing mismatch states                                               | Keep server-authoritative outcomes with clear pending indicators |

## Feature Dependencies

```text
[Deterministic tick + authoritative state broadcast] (v0.0.1 baseline)
    └──enables──> [STRUCT-INT integrity/HP repair loop]
                        └──feeds──> [Hover structure health/details]

[Spawn/base initialization + breach resolver] (v0.0.1 baseline)
    └──required-by──> [BASE-SHAPE 5x5/16-cell footprint]

[Build queue validation + rejection reasons] (v0.0.1 baseline)
    └──required-by──> [BUILD-ZONE union radius=15]
                            └──enhanced-by──> [PLACE-XFORM rotate/mirror]
                            └──updated-by──> [Destroy action shrinks zones]

[UI modularization]
    └──enables──> [Lobby/in-game separation]
                       └──enables──> [Pan/zoom + overlays + hover interactions]
```

### Dependency Notes

- **`STRUCT-INT` before rich structure UI:** hover/detail surfaces are only trustworthy once template-wide integrity and HP behavior are authoritative.
- **`BASE-SHAPE` and `BUILD-ZONE` should be validated together:** footprint/radius changes jointly define pressure lanes and breach pacing.
- **`PLACE-XFORM` depends on stable legality checks:** transformed placements must run through the same authoritative validation as non-transformed placements.
- **Destroy must immediately affect build eligibility:** removing structures must recompute union zones to avoid stale client previews.
- **UI modularization should precede heavy map UI work:** lowers regression risk while adding camera transforms, overlays, and hover interactions.

## MVP Definition

### Launch With (v0.0.2)

- [ ] `STRUCT-INT` template-wide integrity/HP repair loop with deterministic tests
- [ ] `BASE-SHAPE` 5x5/16-cell base footprint integrated with breach outcomes
- [ ] `BUILD-ZONE` union-of-structure build eligibility at radius 15
- [ ] `PLACE-XFORM` rotate/mirror placement supported in validation + UI controls
- [ ] `UI-MAP` baseline structure hover details + single-structure destroy flow
- [ ] `UI-MAP` practical pan/zoom + economy/build/team overlays
- [ ] `UI-ARCH` lobby/in-game separation and modularized UI code organization

### Add After Validation (v0.0.2.x)

- [ ] Overlay polish (extra visual modes, richer toggles) after readability is confirmed in playtests
- [ ] Transform QoL (hotkeys, repeat placement workflows) after baseline rotate/mirror adoption is validated
- [ ] Advanced structure panel workflows (sorting/filtering/history) after baseline hover/destroy telemetry exists

### Future Consideration (v0.0.3+)

- [ ] New transport/runtime stack changes (WASM/protobuf/protocol redesign)
- [ ] Auth, progression, and matchmaking services
- [ ] High-scale map/performance rearchitecture
- [ ] Replay, spectator, or timeline-scrubbing systems

## Feature Prioritization Matrix

| Feature                                           | User Value               | Implementation Cost | Priority |
| ------------------------------------------------- | ------------------------ | ------------------- | -------- |
| `STRUCT-INT`                                      | HIGH                     | HIGH                | P1       |
| `BASE-SHAPE`                                      | HIGH                     | MEDIUM              | P1       |
| `BUILD-ZONE`                                      | HIGH                     | HIGH                | P1       |
| `UI-ARCH` separation + modularization             | HIGH                     | MEDIUM              | P1       |
| `PLACE-XFORM`                                     | HIGH                     | HIGH                | P1       |
| `UI-MAP` hover + destroy                          | HIGH                     | MEDIUM              | P1       |
| `UI-MAP` pan/zoom + overlays                      | HIGH                     | HIGH                | P1       |
| Overlay/transform QoL polish                      | MEDIUM                   | MEDIUM              | P2       |
| Minimap/fog-of-war/replay/custom-template systems | LOW (for this milestone) | HIGH                | P3       |

**Priority key:**

- P1: Must have for v0.0.2 milestone closure
- P2: Add once v0.0.2 core behavior is validated
- P3: Explicitly deferred

## Sources

- `/home/alpine/crts-opencode/.planning/PROJECT.md` (HIGH)
- `/home/alpine/crts-opencode/conway-rts/DESIGN.md` (HIGH)

---

_Feature research for: Conway RTS prototype - v0.0.2 Gameplay Expansion_
_Researched: 2026-03-01_
