# Phase 13: GridView Contract and Cell Semantics - Context

**Gathered:** 2026-03-03
**Status:** Ready for planning

<domain>
## Phase Boundary

Freeze one deterministic `GridView.cells()` output contract for transformed cells using `{ x, y, alive }`, with stable ordering and full transformed-cell coverage for all downstream geometry consumers.

</domain>

<decisions>
## Implementation Decisions

### Cell ordering contract

- `GridView.cells()` ordering follows transform traversal order.
- Ordering is coordinate/transform-derived only; never grouped or reordered by `alive` state.
- Determinism guarantee is cross-runtime stable: identical inputs must produce identical ordered output across runs and runtimes.
- Separate tie-break logic is not defined; duplicate coordinates are invalid and handled as errors.

### Cell coverage semantics

- Emit all transformed template cells in the footprint.
- Dead cells are included explicitly as entries with `alive: false`.
- `GridView.cells()` returns raw transformed coordinates (no map-boundary clipping at this contract layer).
- Templates with no alive cells still emit their dead-cell footprint.

### Coordinate anchoring

- Output `{ x, y }` coordinates are anchored to the template anchor.
- Rotation semantics use the defined template pivot.
- Coordinates in the contract are integer grid coordinates only.
- Negative coordinates are valid and must be preserved.

### Duplicate coordinate handling

- Duplicate transformed `{ x, y }` entries are invalid and must raise an error.
- No merge/dedupe behavior is allowed when duplicates occur.
- `alive` conflict resolution is not applicable because duplicates are treated as an error state.
- Duplicate diagnostics are not added to the `cells()` return payload/API contract.

### OpenCode's Discretion

- Exact error type/message details for duplicate-coordinate failures.
- Internal validation timing and guard implementation details, as long as the contract decisions above remain unchanged.

</decisions>

<specifics>
## Specific Ideas

- User preference: "duplicate `{x, y}` should raise an error. this doesn't make sense ever."
- Determinism should be strong enough for repeatable downstream geometry behavior across runtimes.

</specifics>

<deferred>
## Deferred Ideas

None - discussion stayed within phase scope.

</deferred>

---

_Phase: 13-gridview-contract-and-cell-semantics_
_Context gathered: 2026-03-03_
