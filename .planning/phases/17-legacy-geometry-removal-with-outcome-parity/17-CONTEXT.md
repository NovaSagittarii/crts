# Phase 17: Legacy Geometry Removal with Outcome Parity - Context

**Gathered:** 2026-03-03
**Status:** Ready for planning

<domain>
## Phase Boundary

Remove duplicate template/offset-template authoritative geometry logic while preserving equivalent player/client outcomes for representative match flows in scope for this phase. This phase clarifies parity expectations for outcomes and deterministic state, not new gameplay capabilities.

</domain>

<decisions>
## Implementation Decisions

### Parity scenario set

- Must-pass suite uses a core + edge-case mix rather than only happy paths or a near-exhaustive matrix.
- Representative flows must cover all orientation/transform variants used in those flows.
- Scenarios must include both build success paths and invalid/reject paths.
- Any single representative mismatch blocks Phase 17 sign-off.

### Invalid-action equivalence

- Equivalent invalid attempts must preserve outcome + rejection reason parity.
- Client-facing rejection text can vary as long as semantics and reason taxonomy are equivalent.
- Repeated invalid attempts must preserve rejection cadence in the action timeline.
- Invalid attempts must cause no side-effect drift.

### Deterministic state matching

- Deterministic reruns must match both final state and required intermediate checkpoints.
- Checkpoints are compared after each action boundary.
- Resource parity requires exact per-player totals at required comparison points.
- Structure parity requires matching type + board cell + owner at required comparison points.

### Player-visible outcome boundary

- Parity sign-off is based on matching outcome + resulting state + rejection reason.
- Player-facing ordering of quick-succession outcomes must be preserved.
- Meaning/outcome equivalence is required; exact wording/UI polish is not.
- Non-visible drift (for example internal IDs/debug counters) does not block sign-off.

### OpenCode's Discretion

- No explicit "you decide" directives were given in discussion.
- Planner/researcher may choose concrete implementation details so long as the locked parity decisions above are met.

</decisions>

<specifics>
## Specific Ideas

- Parity is strict at the behavior level: any representative mismatch blocks sign-off.
- Literal client text is flexible, but rejection semantics and user-visible behavior must remain equivalent.
- Deterministic checks should be action-by-action for required scenarios, not end-state only.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

_Phase: 17-legacy-geometry-removal-with-outcome-parity_
_Context gathered: 2026-03-03_
