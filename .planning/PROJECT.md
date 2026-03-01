# Conway RTS TypeScript Prototype

## What This Is

This is a shipped TypeScript multiplayer Conway RTS prototype: two players can form a room, start a deterministic match, queue validated build actions, watch economy/queue state in the HUD, and resolve matches with explicit breach outcomes.

## Core Value

Two players can quickly get into a match and use Conway-based strategy to defend their safe cell and breach the opponent's.

## Current Milestone: v0.0.2 Gameplay Expansion

**Goal:** Expand structure-driven strategy and grid-centric controls while keeping simulation rules deterministic and test-traceable.

**Target features:**

- Generalize structure integrity checks to all structure templates: every K ticks, failed integrity consumes structure HP to restore integrity.
- Redesign base footprint to a 5x5 layout made from four 2x2 blocks (16 cells total) so bases are easier to pressure in active play.
- Replace global build radius with the union of per-structure build-radius squares, using radius 15 for this milestone.
- Add structure transform controls (rotate and mirror) for placement across backend validation and frontend placement UX.
- Add structure hover details/actions and support destroy-structure interactions from the in-game UI.
- Refactor web UI into multiple focused modules, add explicit lobby/in-game screen transitions, and add map pan/zoom plus grid-adjacent overlays for economy/build/team info.
- Sequence delivery backend + tests first, then UI integration and interaction polish.

## Current State

**Shipped version:** `v0.0.1` (2026-03-01)

- End-to-end 1v1 loop is operational from room join through defeat lockout.
- Deterministic queue-only mutation pipeline is enforced with explicit terminal outcomes.
- Economy and queue visibility are exposed in the web client with authoritative affordability metadata.
- Quality gates exist for both unit (`QUAL-01`) and integration (`QUAL-02`) coverage.
- Milestone archive artifacts are stored in `.planning/milestones/`.

## Next Milestone Goals

- [ ] Generalize structure HP/integrity checks beyond base core and validate deterministic tick behavior.
- [ ] Implement larger 5x5 base footprint with 16 base cells and align breach pressure around that shape.
- [ ] Switch build eligibility to union-of-structure radii (radius 15) and validate queue/build checks against the new geometry.
- [ ] Add rotate/mirror placement support end-to-end (engine validation + web controls).
- [ ] Ship map pan/zoom, structure hover actions with destroy flow, and grid-adjacent overlays for economy/build/team details.
- [ ] Refactor UI code organization and lock navigation transitions so lobby and in-game are separate focused screens.
- [ ] Keep roadmap under 11 phases with backend/test slices landing before UI-heavy slices.

## Requirements

### Validated in v0.0.1

- ✓ Lobby and reconnect reliability (`LOBBY-01`, `LOBBY-03`, `LOBBY-04`)
- ✓ Match lifecycle and breach outcomes (`MATCH-01`, `MATCH-02`, `MATCH-03`)
- ✓ Deterministic build queue validation (`BUILD-01`, `BUILD-02`, `BUILD-03`, `BUILD-04`)
- ✓ Economy + queue visibility (`ECON-01`, `ECON-02`, `ECON-03`, `UX-01`)
- ✓ Quality gates (`QUAL-01`, `QUAL-02`)
- Delivered capability (excluded from closure accounting): `LOBBY-02`

### Active (Next Milestone Candidates)

- [ ] `STRUCT-INT`: Template-wide integrity checks and HP restoration rules
- [ ] `BASE-SHAPE`: Expanded base footprint and breach pressure updates
- [ ] `BUILD-ZONE`: Union-of-structure radius build eligibility (radius 15)
- [ ] `PLACE-XFORM`: Rotate/mirror placement controls across engine + client
- [ ] `UI-MAP`: Pan/zoom, structure hover actions, destroy flow, and grid-adjacent overlays
- [ ] `UI-ARCH`: Web UI modular refactor and lobby/in-game screen transitions

### Out of Scope

- WebAssembly simulation pipeline — prototype still optimizes for TypeScript iteration speed.
- Protobuf network protocol — Socket.IO JSON contracts remain sufficient for current scope.
- Account/auth system and persistent profile storage — session identity remains enough for prototype validation.
- Large-scale performance hardening for very large maps — defer until expansion requirements are validated.

## Context

- Monorepo architecture remains `apps/` for runtime layers and `packages/` for deterministic reusable logic.
- Milestone `v0.0.1` shipped across 5 phases, 16 plans, and 48 documented tasks.
- Quality gates now include explicit `test:quality` command composition (`test:unit` + `test:integration`).
- Milestone artifacts are archived for stable context usage in future planning.

## Constraints

- **Tech stack:** TypeScript + Node.js + Socket.IO + Vite; keep deterministic logic in shared packages.
- **Scope control:** Avoid wasm/protobuf/auth persistence until expansion scope requires them.
- **Quality gate:** Maintain requirement-traceable tests for each new milestone requirement.
- **UX reliability:** Preserve authoritative server payloads as the only source for client state.

## Key Decisions

| Decision                                                    | Rationale                                                             | Outcome   |
| ----------------------------------------------------------- | --------------------------------------------------------------------- | --------- |
| Build as TypeScript-only prototype (no wasm, no protobuf)   | Reduces integration complexity and keeps iteration fast               | ✓ Good    |
| Prioritize lobby/team reliability before deeper strategy    | Setup friction blocks all gameplay validation if left unresolved      | ✓ Good    |
| Treat playable end-to-end match as milestone completion bar | Ensures delivery reflects real player flow, not disconnected features | ✓ Good    |
| Keep server-authoritative deterministic simulation model    | Preserves consistency across runtime layers and tests                 | ✓ Good    |
| Prioritize backend + tests before UI-heavy milestone slices | Reduces UI churn and catches game-rule regressions early              | — Pending |
| Cap v0.0.2 delivery roadmap to at most 11 phases            | Keeps expanded scope tractable while preserving milestone momentum    | — Pending |

---

_Last updated: 2026-03-01 after v0.0.2 milestone kickoff_
