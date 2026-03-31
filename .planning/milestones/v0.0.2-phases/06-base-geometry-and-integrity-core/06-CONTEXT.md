# Phase 6: Base Geometry and Integrity Core - Context

**Gathered:** 2026-03-01
**Status:** Ready for planning

<domain>
## Phase Boundary

Implement deterministic base/integrity foundation work for v0.0.2: migrate to the canonical 5x5 base footprint (16 base cells) and generalize integrity plus HP repair from core-only behavior to all player-owned structures. This phase is backend-first gameplay logic and contract behavior only; union build zones, transform placement, destroy commands, and map UI changes are out of scope.

</domain>

<decisions>
## Implementation Decisions

### Base footprint and breach evaluation

- Base anchor remains `team.baseTopLeft` and denotes the top-left of a `5x5` base bounding box.
- Canonical occupied base cells are the four corner `2x2` blocks in that `5x5` box.
- In local base coordinates `(x, y)` from `(0..4, 0..4)`, occupied cells are where `x in {0,1,3,4}` and `y in {0,1,3,4}` (16 cells total).
- Breach checks evaluate only the canonical 16 occupied cells; the center cross is not directly checked.
- Breach pressure scales linearly with the number of compromised canonical cells.

### Base integrity restoration and `baseIntact` semantics

- `baseIntact` remains authoritative and is true when core HP is above 0.
- When canonical base integrity fails and core HP remains above 0, integrity is auto-restored during the same check processing.
- Base restore cost is `1 HP` per canonical cell that must be flipped back to canonical state.
- Restoration and resulting HP updates must be deterministic across identical runs.

### Base center, territory, and spawn spacing

- Canonical base center is `(baseTopLeft.x + 2, baseTopLeft.y + 2)`.
- Territory placement validation and territory cell counting use this center anchor.
- Spawn layout and overlap checks continue using base footprint dimensions `5x5`.
- Spawn minimum wrapped distance is geometry-derived as `3 * baseWidth` (`15` for the `5x5` footprint in this phase).
- If ideal spawn points fail constraints, fallback selection uses deterministic seeded randomness so identical seeds produce identical outcomes.

### Integrity cadence and structure HP outcomes

- Breach/integrity restore checks run on one shared configurable interval `N` simulation ticks (not hardcoded every tick).
- `N` must be defined in shared gameplay rules/config consumed consistently by engine, server, and deterministic tests.
- Every placed player-owned template is integrity-tracked in Phase 6.
- Integrity masks default to all live template cells, so templates without explicit `checks` still participate.
- Integrity evaluation order is deterministic: team ID ascending, then stable structure ordering.
- Integrity and HP writes occur only in one authoritative tick phase; queue/preview paths remain read-only.
- Failed integrity checks charge the full restoration cost; if that cost exceeds current HP, apply full cost (HP may go negative), destroy the structure, and leave a debris-state footprint.
- Initial HP constants remain locked to: core `3`, non-core integrity-tracked structures `2`.

### Defeat and destruction semantics under `5x5` rules

- Team defeat is triggered only by core HP less than or equal to 0.
- Core damage follows the same full restoration-cost accounting and may underflow before defeat resolution.
- On core destruction, the team is marked defeated once, pending queued builds drain deterministically with `team-defeated`, and canonical outcome ranking remains stable.
- Destroyed structures do not rewrite the underlying Conway grid; only structure-specific properties and effects are removed.
- Integrity outcomes must be emitted in deterministic stable order with explicit outcome categories: `repaired`, `destroyed-debris`, and `core-defeat`.

### OpenCode's Discretion

- Exact helper/module names for geometry and integrity extraction.
- Config key naming and default value for the shared integrity interval `N`.
- Exact timeline/event metadata shape for per-structure integrity outcomes.
- Internal representation and caching strategy for debris-state structures and integrity masks, as long as deterministic behavior is preserved.

</decisions>

<specifics>
## Specific Ideas

- Canonical 5x5 base shape reference for docs and tests:
  - `##.##`
  - `##.##`
  - `.....`
  - `##.##`
  - `##.##`
- Keep Phase 6 execution backend-first (`packages/rts-engine`, then server contract update), then verify with unit and integration tests before any Phase 7+ UI work.
- Integrity restore cost should scale with repair work (`1 HP` per flipped cell), including core restoration.
- Shared check cadence must be configurable in tick units to support higher-impact damage pacing in a tick-based simulation.
- Spawn spacing should follow `3 * baseWidth`, with deterministic seeded fallback when strict spacing cannot be met.

</specifics>

<deferred>
## Deferred Ideas

- Union build-zone legality and fixed radius 15 behavior (`BUILD-01`, `BUILD-02`) are deferred to Phase 7.
- Rotate/mirror placement consistency (`XFORM-01`, `XFORM-02`, `QUAL-03`) is deferred to Phase 8.
- Destroy command outcomes and reconnect determinism expansion (`STRUCT-02`, `QUAL-04`) are deferred to Phase 9.
- Match-screen split, camera/build-zone visualization, and hover/overlay interaction surfaces are deferred to Phases 10-12.
- Add map-size vs max-player limits as a dedicated future phase so spawn feasibility constraints are explicit per map.

</deferred>

---

_Phase: 06-base-geometry-and-integrity-core_
_Context gathered: 2026-03-01_
