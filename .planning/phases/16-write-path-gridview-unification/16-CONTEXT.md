# Phase 16: Write-Path GridView Unification - Context

**Gathered:** 2026-03-03
**Status:** Ready for planning

<domain>
## Phase Boundary

Unify placement preview, queue validation, and build apply behind one GridView-backed geometry flow so the same input yields consistent legality outcomes and transformed coordinates, while preserving existing rejection and resource-cost behavior.

</domain>

<decisions>
## Implementation Decisions

### Rejection reason precedence

- Keep current precedence order when multiple constraints fail.
- Preserve the same rejection codes and wording after unification.
- Return only one deterministic top rejection reason across preview, queue validation, and apply.
- If a migrated failure does not map cleanly, use the existing generic rejection reason.

### Preview/apply consistency

- Preview can be invalidated by state changes before queue/apply; queue/apply must revalidate against current state and may reject.
- On those rejects, surface the current-state rejection reason (not a new custom message).
- After a reject caused by changed state, auto-refresh preview.
- Queue validation must mirror preview with an identical ruleset.

### Transform edge behavior on torus map

- Treat map topology as torus: out-of-bounds rejection should never surface to players.
- Geometrically equivalent orientations must always produce the same legality outcome.
- Seam crossings use exact wrapped transformed cells; no tolerance/snap behavior.
- Preview for seam-crossing placements must render the wrapped footprint where cells land.
- Overlap behavior remains parity with current gameplay: placing structures over each other overwrites.

### Resource charge timing

- Keep current resource charge timing (no behavior change from pre-unification flow).
- If apply rejects after queue validation passed, do not charge resources.
- Preview should show exact cost and current affordability.
- If affordability changes and apply rejects, show the current-state cost rejection reason with existing wording.

### OpenCode's Discretion

- Visual styling details for affordability display and wrapped-footprint preview.
- Exact UX timing/animation details for preview refresh after rejection.

</decisions>

<specifics>
## Specific Ideas

- "The map is a torus, so there is no outside footprint possible."
- "Overwrite is the default behavior when placing structures over each other."

</specifics>

<deferred>
## Deferred Ideas

- Add a future capability to prevent placing structures over each other.

</deferred>

---

_Phase: 16-write-path-gridview-unification_
_Context gathered: 2026-03-03_
