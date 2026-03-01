# Phase 8: Transform Placement Consistency - Context

**Gathered:** 2026-03-01
**Status:** Ready for planning

<domain>
## Phase Boundary

Enable rotate and mirror controls for structure placement so players can transform templates before preview and queue placement. Keep transformed placement behavior consistent across preview legality, queue accept/reject outcomes, and applied simulation footprints/orientations.

This phase clarifies transform behavior within build placement only. New placement-adjacent capabilities outside this flow remain out of scope.

</domain>

<decisions>
## Implementation Decisions

### Transform controls and state model

- Rotation uses a single cycle control: `0deg -> 90deg -> 180deg -> 270deg -> 0deg`.
- Mirroring uses separate controls for horizontal and vertical mirror.
- Combined transforms are order-sensitive: final shape follows the exact user press sequence.
- Transform state persists until manually changed (it does not auto-reset after queue attempts or successes).
- Transform state should be representable as a composable transform matrix so multiple transforms can be encoded/applied efficiently across systems.

### Preview visualization and legality feedback

- Preview renders the full occupied-cell footprint and also shows a bounding box.
- Preview communicates validity with short reason labels (not color-only).
- When only part of the footprint is illegal, illegal cells render in red while legal cells keep normal preview coloring.
- Map edge crossing is legal under torus wrapping behavior.
- A transformed placement is invalid only when the template exceeds map-size constraints (not simply because it crosses an edge).

### Queue outcomes and build-mode interaction

- Successful queue attempts show a small non-blocking confirmation and update queue panel state.
- Rejected queue attempts use the same short reason taxonomy as preview feedback.
- After rejection, keep preview anchor and transform so the player can adjust quickly.
- After acceptance, keep preview active and keep transform persisted for repeated placements.
- Add an explicit "Cancel Build Mode" button so players can exit placement mode deliberately.

### Parity and authoritative reconciliation

- Symmetric/no-op transforms still update transform state and show explicit transform indicators.
- If preview appears valid locally but server rejects (state changed), show the authoritative reject reason and immediately refresh preview legality.
- Queue action is disabled when preview is invalid, with reason visible.
- "Template exceeds map size" is an explicit invalid reason and blocks queueing.

### OpenCode's Discretion

- Exact control placement and visual styling for rotate/mirror actions, transform indicators, and confirmation UI.
- Exact wording/iconography for reason labels, as long as preview and reject messages remain taxonomy-consistent.
- Internal transform representation details (for example, matrix caching strategy) as long as user-facing order-sensitive semantics remain correct.

</decisions>

<specifics>
## Specific Ideas

- Use a matrix-based transform representation to compose rotate/mirror sequences efficiently.
- Preserve torus expectations: wrapping near edges should not become an invalid case by itself.
- Keep rapid-placement flow ergonomic: persistent transform plus clear manual exit via Cancel Build Mode.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

_Phase: 08-transform-placement-consistency_
_Context gathered: 2026-03-01_
