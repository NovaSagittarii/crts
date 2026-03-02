# Phase 11: Camera and Build-Zone Visualization - Context

**Gathered:** 2026-03-01
**Status:** Ready for planning

<domain>
## Phase Boundary

Players can pan and zoom the in-match map with accurate controls while preserving precise placement and targeting behavior across supported zoom levels. During matches, the authoritative union build-zone is visualized and updates as structures are added or destroyed.

</domain>

<decisions>
## Implementation Decisions

### Camera input model

- Desktop panning uses right-mouse drag.
- Keyboard panning is supported with both WASD and arrow keys.
- Zoom supports mouse wheel, trackpad pinch, and keyboard `+`/`-`.
- Zoom is cursor-anchored (zoom toward pointer position, not screen center).

### Camera limits and reset behavior

- Supported zoom range is `0.45x` minimum to `1.6x` maximum.
- Camera panning can move outside the map margin (no hard edge clamp in this phase).
- `F` resets the camera to the player's base at default zoom.

### Build-zone visual style

- The union build-zone is always visible during matches.
- When not placing, zone rendering stays subtle; while placing, visibility is increased.
- Zone rendering uses outline plus subtle translucent fill.
- Only the local player's union-zone is shown.
- Invalid placement feedback uses a red ghost plus explicit out-of-zone cell highlights.

### Overlay timing and layering rules

- Union-zone geometry updates immediately on authoritative structure add/destroy updates.
- Zone updates redraw instantly with no transition animation.
- Draw order: above terrain/grid, below structures and placement ghost.
- Invalid-cell highlights and placement ghost have top visual priority over zone rendering.

### OpenCode's Discretion

- Exact color values, opacity levels, and stroke thicknesses, as long as idle vs placing emphasis remains distinct.
- Exact pan speed, zoom step increments, and smoothing values, as long as targeting/placement precision remains consistent.
- Exact default zoom value used by reset, as long as reset behavior consistently returns to player-base focus.

</decisions>

<specifics>
## Specific Ideas

- Keep the always-visible zone less noticeable when idle, then make it more visible during placement.
- Preserve RTS-style interaction feel with right-drag panning and cursor-anchored zooming.

</specifics>

<deferred>
## Deferred Ideas

- Torus wrap-around camera traversal (looping across top/bottom) is deferred to a future phase (suggested Phase 13+).

</deferred>

---

_Phase: 11-camera-and-build-zone-visualization_
_Context gathered: 2026-03-01_
