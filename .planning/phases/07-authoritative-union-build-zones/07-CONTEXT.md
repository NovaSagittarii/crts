# Phase 7: Authoritative Union Build Zones - Context

**Gathered:** 2026-03-01
**Status:** Ready for planning

<domain>
## Phase Boundary

Enforce authoritative structure placement legality using the union of build-radius zones from a player's owned structures, with fixed radius `15` checks and deterministic eligibility updates when structures are created or destroyed. This phase defines gameplay rule behavior and server-authoritative outcomes; transform controls, destroy command UX, and build-zone visualization surfaces remain outside this phase boundary.

</domain>

<decisions>
## Implementation Decisions

### Zone contributors and activation

- Union-zone contributors are all owned, placed structures with `HP > 0`.
- A newly placed structure starts contributing only after authoritative construction completion (not at queue/preview time).
- A structure stops contributing immediately when authoritative destroy/removal resolves.
- Queued or pending (not-yet-placed) structures do not contribute to union coverage.

### Union legality semantics

- Build-radius value is fixed to `15` for this milestone.
- Radius boundary is inclusive: cells exactly at distance `15` are legal.
- Placement is legal only if the full footprint is inside union coverage; any outside cell rejects the entire placement.
- Footprint cells may be covered by different contributing structures (true union stitching is valid).
- Radius shape uses circular (Euclidean-style) checks for gameplay semantics in this phase.
- Keep the radius-shape implementation internally configurable for future testing; gameplay behavior in this phase remains circular with fixed radius `15`.

### Authoritative reject feedback

- Rejections include a stable machine reason code and a human-readable message.
- Out-of-zone player message: "Outside build zone — build closer to your structures."
- Repeated identical invalid attempts are de-duplicated with a short cooldown to avoid feedback spam.
- If multiple legality checks fail simultaneously, return one deterministic primary reason, with out-of-zone prioritized first.

### Eligibility update timing and queue outcomes

- Eligibility expands immediately on authoritative construction completion.
- Eligibility shrinks immediately on authoritative destroy/removal.
- Queued placements are revalidated at authoritative resolve time; if no longer legal, reject and refund placement cost.
- Active placement targeting updates legality immediately when authoritative zone state changes.

### OpenCode's Discretion

- Exact reason-code identifiers and payload field naming.
- Exact cooldown duration and deduplication window semantics.
- Internal test-time toggles/config hooks for radius-shape behavior (without changing locked gameplay defaults for this phase).
- Internal module/function naming and organization for union-zone checks and revalidation flow.

</decisions>

<specifics>
## Specific Ideas

- Boundary behavior should be clear to players because zone boundaries will be visualized in a later UI phase; inclusive-edge legality avoids ambiguity at the radius line.
- Rejection feedback should stay short and actionable instead of verbose diagnostics.
- If a queued placement becomes invalid because the zone shrank, refund should happen as part of the authoritative rejection result.

</specifics>

<deferred>
## Deferred Ideas

- None — discussion stayed within the Phase 7 scope boundary.

</deferred>

---

_Phase: 07-authoritative-union-build-zones_
_Context gathered: 2026-03-01_
