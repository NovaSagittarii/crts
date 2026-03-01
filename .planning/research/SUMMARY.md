# Project Research Summary

**Project:** Conway RTS TypeScript Prototype
**Domain:** Deterministic multiplayer Conway RTS gameplay expansion (v0.0.2)
**Researched:** 2026-03-01
**Confidence:** HIGH

## Executive Summary

v0.0.2 is a gameplay expansion on top of a working deterministic 1v1 prototype, not a platform rewrite. Across the research set, the strongest agreement is to keep the existing server-authoritative TypeScript architecture and implement new gameplay rules in `packages/rts-engine` first: template-wide integrity and HP repair, a 5x5 base footprint, union-of-structure build zones, transform-aware placement, and queued destroy actions. The browser remains a rendering and input layer driven by authoritative state snapshots.

The recommended approach is backend/tests-first with explicit contract freeze before UI feature work, and a roadmap that stays under the 11-phase cap (recommended: 9 phases). Keep the current runtime stack (Socket.IO + TypeScript + Canvas 2D + Vitest), add `fast-check` immediately for transform and build-zone invariants, and defer optional tooling changes (`zod`, `d3-zoom`, TypeScript/Vite/Vitest upgrades) unless concrete complexity triggers appear.

Key risks are deterministic drift (tick order changes), geometry drift (hidden 2x2 assumptions after base migration), validation drift (preview, queue, and overlay disagree), and identity drift (destroy targeting without stable IDs). Mitigate these by centralizing rule execution in one ordered tick phase, reusing the same validator for preview and queue, introducing stable `structureId`, enforcing lifecycle gates on all gameplay mutations, and expanding unit/integration quality gates before UI polish.

## Key Findings

### Recommended Stack

Stack research is clear: v0.0.2 should ship on the current architecture with targeted upgrades only where milestone risk is highest. The required technical moves are Socket.IO parity (`4.8.3`) and property-based testing with `fast-check` for deterministic geometry and command-order invariants.

Critical version note: keep TypeScript at `5.4.5` unless adopting `zod@4`, which should be paired with a planned TS upgrade (`5.9.3` target). Keep Canvas 2D + Pointer Events as-is; no frontend framework or renderer migration is justified for this milestone.

**Core technologies:**

- `Socket.IO 4.8.3` (server + client parity): typed event transport for new transform/destroy surface area without protocol drift.
- `TypeScript 5.4.5` baseline (`5.9.3` target when needed): strict contract and geometry typing across engine/server/web.
- `Canvas 2D + Pointer Events`: sufficient for pan/zoom and overlays while preserving current web architecture.
- `Vitest + fast-check`: deterministic and property-based validation for backend-first slices.
- Optional `zod` and `d3-zoom`: add only when payload guards or camera interactions become a sustained maintenance burden.

### Expected Features

Feature research maps a strict v0.0.2 closure set: seven P1 capabilities must land together for a coherent experience. Most "nice-to-have" asks are explicitly deferred because they increase desync and delivery risk without improving milestone validation.

**Must have (table stakes):**

- `STRUCT-INT`: template-wide integrity checks plus HP-backed repair loop with deterministic cadence.
- `BASE-SHAPE`: canonical 5x5/16-cell base geometry integrated with breach logic.
- `BUILD-ZONE`: union-of-structure build eligibility at fixed radius 15.
- `PLACE-XFORM`: rotate/mirror placement in both validation and gameplay UI.
- `UI-MAP`: structure hover metadata plus single-structure destroy flow.
- `UI-MAP`: practical pan/zoom and clear economy/build/team overlays.
- `UI-ARCH`: lobby/in-game screen separation plus web client modularization.

**Should have (competitive, post-core validation):**

- Overlay readability polish (extra modes/toggles after baseline correctness is proven).
- Transform QoL improvements (hotkeys/repeat placement) after baseline adoption data exists.
- Richer structure panel workflows (sorting/filtering/history) once hover/destroy telemetry is stable.

**Defer (v2+):**

- Custom template editor and user-uploaded template sharing.
- Minimap, fog-of-war, cinematic camera effects.
- Bulk destroy and undo/redo timeline editing.
- Multiple base archetypes or custom base geometry.
- Runtime/transport overhauls (framework migration, WASM, protobuf, replay/spectator systems).

### Architecture Approach

Architecture research recommends a layered, contract-first implementation: deterministic gameplay logic in `packages/rts-engine`, runtime orchestration and lifecycle gating in `apps/server`, and UI state/render modules in `apps/web` that consume authoritative projections only. The highest leverage pattern is a unified command model (`build` + `destroy`) with shared validation paths for preview and queue to eliminate drift.

**Major components:**

1. `packages/rts-engine` deterministic core - transform math, build-zone eligibility, integrity/repair cadence, queued build/destroy commands, base/breach rules.
2. `apps/server/src/server.ts` orchestration layer - payload parsing, lifecycle gate enforcement, engine invocation, room broadcasts.
3. `packages/rts-engine/socket-contract.ts` shared contracts - typed payloads/reasons/outcomes kept in lockstep across server, web, and tests.
4. `apps/web` modular client - store/socket bridge, lobby/game views, camera + overlays, feature controls without simulation logic.
5. `tests/integration/server/*` quality gate - two-client, lifecycle-aware verification of all new contracts and deterministic outcomes.

### Critical Pitfalls

1. **Tick-order drift during integrity generalization** - run integrity/HP writes in one ordered engine phase only; never in preview/UI paths.
2. **Hidden 2x2 assumptions after 5x5 migration** - replace magic offsets with one shared `BaseGeometry` model used everywhere.
3. **Preview/queue/UI build-zone divergence** - route all legality checks through one engine helper and render overlays from authoritative projections.
4. **Transform mismatch and structure identity collisions** - centralize rotate/mirror math in shared package and use stable `structureId` for destroy targeting.
5. **Destroy bypasses queue/lifecycle gates** - model destroy as queued intent with terminal outcomes and strict ownership/lifecycle checks.

## Implications for Roadmap

Based on combined research, use a 9-phase roadmap (within the 11-phase cap) that preserves backend/tests-first delivery.

### Phase 1: Contract Freeze and Engine Seams

**Rationale:** Freeze protocol and extraction seams before behavior changes to prevent cross-layer churn.
**Delivers:** Extended `socket-contract.ts`, extracted engine modules (`placement-transform`, `build-zone`, `structure-integrity`, `structure-commands`) with no behavior change.
**Addresses:** Foundation for `STRUCT-INT`, `BUILD-ZONE`, `PLACE-XFORM`, and destroy lifecycle.
**Avoids:** Event-contract drift and early deterministic regressions.

### Phase 2: Base Geometry + Integrity Generalization

**Rationale:** Base shape and integrity cadence are foundational mechanics for all later pressure/breach behavior.
**Delivers:** Canonical 5x5/16-cell base model and generic K-tick integrity+HP repair flow with deterministic ordering.
**Addresses:** `BASE-SHAPE`, `STRUCT-INT`.
**Avoids:** Tick-order drift, hidden 2x2 assumptions, untestable rebalance churn.

### Phase 3: Authoritative Union Build-Zone

**Rationale:** Build legality must stabilize before transform UX and overlay rendering.
**Delivers:** Shared `isPlacementBuildEligible` logic (radius 15), server-projected build-zone sources, preview/queue parity tests.
**Addresses:** `BUILD-ZONE`.
**Avoids:** "overlay says yes, server says no" contradictions.

### Phase 4: Transform-Aware Placement End-to-End

**Rationale:** Placement controls are high-value but depend on stable zone/base validators.
**Delivers:** Shared rotate/mirror normalization, contract extensions in preview+queue payloads, transformed footprint metadata in responses.
**Addresses:** `PLACE-XFORM` backend contracts and deterministic behavior.
**Avoids:** Client/server transform drift and orientation-specific rejection bugs.

### Phase 5: Stable Structure Identity + Destroy Command Flow

**Rationale:** Destroy is lifecycle-sensitive and unsafe without stable IDs and queue semantics.
**Delivers:** Monotonic `structureId`, queued `structure:destroy`, ownership/core/lifecycle guardrails, terminal `structure:outcome` reasons.
**Addresses:** `UI-MAP` destroy behavior and zone shrink updates.
**Avoids:** Wrong-target deletes, non-deterministic races, spectator/defeated mutation leaks.

### Phase 6: Derived-State Recompute Hardening

**Rationale:** Hover/economy/zone UI reliability depends on coherent derived state right after mutations.
**Delivers:** Single post-mutation recompute pass and consistent projection of structures/zones/health metadata.
**Addresses:** `UI-MAP` data correctness for overlays and hover cards.
**Avoids:** One-tick stale income/zone/hover desync.

### Phase 7: Web Architecture Split and Screen FSM

**Rationale:** Separate lobby/game responsibilities before adding heavy map interactions.
**Delivers:** `client.ts` bootstrap-only, modular store/socket/view/render structure, explicit lobby<->game transition FSM.
**Addresses:** `UI-ARCH` with lower regression risk.
**Avoids:** Listener duplication, stale interaction state, monolith coupling.

### Phase 8: Gameplay UI Integration (Camera, Overlays, Controls)

**Rationale:** UX features should consume frozen contracts and authoritative projections, not drive rule design.
**Delivers:** Pan/zoom camera, grid overlays, hover detail panel, rotate/mirror controls, destroy action UX.
**Addresses:** `UI-MAP` and `PLACE-XFORM` player-facing interactions.
**Avoids:** Pointer mapping drift and ghost/applied mismatch.

### Phase 9: Quality-Gate Expansion and Balance Validation

**Rationale:** Milestone closure requires deterministic confidence, not just feature visibility.
**Delivers:** Expanded unit/property/integration coverage, scenario fixtures for breach-pressure tuning, acceptance bands for match outcomes.
**Addresses:** Final verification for all v0.0.2 P1 requirements.
**Avoids:** Regression slip and unstable gameplay pacing.

### Phase Ordering Rationale

- Contract-first and backend-first ordering minimizes UI churn and keeps deterministic behavior testable as complexity rises.
- Architecture groupings follow dependency direction: engine rules -> server contracts -> web composition -> interaction UX.
- Pitfall prevention is front-loaded: highest-risk drift classes (tick, geometry, contract, identity) are addressed before camera/overlay polish.

### Research Flags

Phases likely needing deeper `/gsd-research-phase` during planning:

- **Phase 8:** Camera/input correctness at varied zoom and overlay rendering performance may require implementation-option validation (`d3-zoom` threshold, redraw strategy).
- **Phase 9:** Balance acceptance bands and deterministic scenario design need explicit metric definitions before gate automation.
- **Phase 6:** If structure counts rise, recompute-vs-incremental derived-state strategy may need targeted performance research.

Phases with standard patterns (can usually skip deeper research):

- **Phase 1:** Contract-first Socket.IO typing and seam extraction are well-documented and low novelty.
- **Phase 3:** Shared validator pattern for preview/queue is established and directly supported by current architecture.
- **Phase 5:** Queue-modeled destroy with ownership/lifecycle gate reuse follows existing server-authoritative mutation patterns.
- **Phase 7:** UI modularization + explicit screen FSM is conventional refactor work with low domain uncertainty.

## Confidence Assessment

| Area         | Confidence | Notes                                                                                                                                                |
| ------------ | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Stack        | HIGH       | Recommendations are grounded in official docs and current repo compatibility; optional libraries are clearly trigger-gated.                          |
| Features     | HIGH       | Milestone requirements are explicit in project docs and strongly aligned across feature and architecture research.                                   |
| Architecture | MEDIUM     | Backend boundaries and contracts are clear; exact frontend module decomposition and camera integration details still need implementation validation. |
| Pitfalls     | HIGH       | Risks are code-informed, phase-mapped, and paired with concrete warning signs and prevention tactics.                                                |

**Overall confidence:** HIGH

### Gaps to Address

- **Integrity cadence tuning:** lock K-tick and HP cost values early, then validate with deterministic scenario fixtures before UI balancing.
- **Canonical 5x5 geometry spec:** publish one definitive coordinate/check-cell contract to prevent hidden legacy assumptions.
- **Derived-state performance thresholds:** define when to switch from full recompute to incremental updates as structure counts grow.
- **Camera input acceptance criteria:** set zoom-level pointer accuracy tests and duplicate-listener guards before shipping Phase 8 UX.
- **Optional dependency trigger points:** predefine measurable thresholds for introducing `zod` or `d3-zoom` to avoid scope creep.

## Sources

### Primary (HIGH confidence)

- `.planning/research/STACK.md` - stack versions, compatibility constraints, required vs optional dependencies.
- `.planning/research/FEATURES.md` - table stakes, differentiators, anti-features, dependency graph.
- `.planning/research/ARCHITECTURE.md` - component boundaries, data flows, dependency-aware build order.
- `.planning/research/PITFALLS.md` - phase-mapped failure modes, prevention strategies, verification signals.
- `.planning/PROJECT.md` - official v0.0.2 scope, constraints, and milestone decisions.
- `conway-rts/DESIGN.md` - gameplay intent and UI interaction expectations.
- Socket.IO docs - typed contracts and delivery guarantees: https://socket.io/docs/v4/typescript/ and https://socket.io/docs/v4/delivery-guarantees
- Vitest + fast-check + MDN Canvas/Pointer docs - deterministic test and camera interaction baselines.

### Secondary (MEDIUM confidence)

- MDN wheel event caveats (device variability risks): https://developer.mozilla.org/en-US/docs/Web/API/Element/wheel_event
- `.planning/codebase/CONCERNS.md` (partially stale, used only as corroboration for fragile areas).

### Tertiary (LOW confidence)

- None.

---

_Research completed: 2026-03-01_
_Ready for roadmap: yes_
