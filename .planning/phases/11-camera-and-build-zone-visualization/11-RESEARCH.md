# Phase 11: Camera and Build-Zone Visualization - Research

**Researched:** 2026-03-02
**Domain:** Canvas camera controls, coordinate-accurate input mapping, and authoritative union-zone overlays
**Confidence:** MEDIUM

<user_constraints>

## User Constraints (from CONTEXT.md)

### Locked Decisions

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

### Deferred Ideas (OUT OF SCOPE)

- Torus wrap-around camera traversal (looping across top/bottom) is deferred to a future phase (suggested Phase 13+).

</user_constraints>

<phase_requirements>

## Phase Requirements

| ID    | Description                                                                               | Research Support                                                                                                                                                                                              |
| ----- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| UI-02 | Player can pan and zoom the map during a match without losing placement/control accuracy. | Use a pure camera view-model for pan/zoom state, cursor-anchored zoom math, and inverse world-to-cell coordinate conversion consumed by pointer handlers.                                                     |
| UI-05 | Player sees the union build-radius outline while placing structures.                      | Project local-team union contributors from authoritative `state.teams[].structures`, then render a persistent zone fill+outline layer with stronger placement emphasis and immediate redraw on state updates. |

</phase_requirements>

## Summary

The current web client renders the board as a fixed-size canvas with direct `cellSize` coordinate mapping (`pointerToCell` divides pointer coordinates by `cellSize`), so there is no camera state for pan/zoom today. This means Phase 11 should avoid patching input math ad hoc in `client.ts`; instead, add a small pure camera helper module that owns zoom clamping, cursor-anchored zoom, and world/screen conversion so pointer targeting remains deterministic and testable.

Build-zone visualization can be driven from already-authoritative payloads. `state.teams[].structures` already provides transformed structure width/height and occupied footprints, and engine legality currently computes contributor centers as `x + floor(width / 2)` and `y + floor(height / 2)` with fixed radius-15 checks. Reusing this contributor projection as a shared helper (instead of re-implementing slightly different math in the browser) reduces drift risk between legality and visualized zone boundaries.

Render layering should be explicit: terrain/grid first, then zone fill+outline, then structure/preview overlays with invalid-cell highlights and placement ghost on top. This keeps the always-visible zone subtle during idle and stronger while placing, while preserving the locked decision that illegal placement cues remain highest-priority feedback.

**Primary recommendation:** Create shared, pure camera and build-zone projection helpers with focused tests first, then wire them into `apps/web/src/client.ts` and `apps/web/index.html` for right-drag/keyboard pan, cursor-anchored zoom, `F` reset, and authoritative local-team union-zone rendering.

## Standard Stack

### Core

| Library                                       | Version    | Purpose                                                  | Why Standard                                                                                                                        |
| --------------------------------------------- | ---------- | -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Browser Canvas 2D API                         | platform   | Deterministic board and overlay rendering passes         | Existing rendering path already uses a single 2D canvas; camera can be added with transform-aware draw and inverse pointer mapping. |
| Pointer + Wheel + Keyboard events             | platform   | Pan, zoom, and reset input capture                       | Matches locked UX decisions without adding external gesture dependencies.                                                           |
| `#rts-engine` (`rts.ts`, `gameplay-rules.ts`) | repo-local | Canonical build-zone constants and contributor semantics | Keeps legality and visualization aligned on radius/shape and contributor-center rules.                                              |
| `typescript`                                  | `5.4.5`    | Strictly typed camera state and conversion helpers       | Reduces accidental drift in coordinate spaces and event wiring.                                                                     |

### Supporting

| Library                                                                                       | Version    | Purpose                              | When to Use                                                                                       |
| --------------------------------------------------------------------------------------------- | ---------- | ------------------------------------ | ------------------------------------------------------------------------------------------------- |
| `vitest`                                                                                      | `1.6.0`    | Fast deterministic helper tests      | Cover camera transform math and build-zone contributor projection without DOM runtime complexity. |
| Existing web view-model pattern (`placement-transform-view-model`, `match-screen-view-model`) | repo-local | Pure helper + focused tests workflow | Mirror this pattern for camera behavior to keep `client.ts` manageable.                           |

### Alternatives Considered

| Instead of                          | Could Use                                   | Tradeoff                                                                                                        |
| ----------------------------------- | ------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Shared helper for contributor math  | Recompute zone math directly in `client.ts` | Faster to start, but high drift risk from engine legality semantics over future phases.                         |
| Canvas-space camera transform state | CSS-transforming the canvas DOM node        | CSS transform looks simple but breaks pointer/cell mapping unless inverse transforms are maintained separately. |
| Wheel normalization + keyboard zoom | Gesture-only implementation                 | Misses locked keyboard `+`/`-` support and complicates desktop consistency.                                     |

**Installation:**

```bash
# No new dependencies are required for Phase 11.
npm install
```

## Architecture Patterns

### Recommended Project Structure

```text
apps/web/
├── index.html                         # Camera hints/legend and in-game viewport shell adjustments
└── src/
    ├── client.ts                      # Runtime event wiring + render loop integration
    └── camera-view-model.ts           # NEW: pure camera state/math helpers (pan, zoom, reset, coordinate conversion)

packages/rts-engine/
├── build-zone.ts                      # NEW: shared union-zone contributor and coverage helpers
├── build-zone.test.ts                 # NEW: deterministic helper tests
└── rts.ts                             # consume shared helper to preserve legality parity

tests/web/
└── camera-view-model.test.ts          # NEW: deterministic camera math regression coverage
```

### Pattern 1: Pure Camera State + Inverse Coordinate Mapping

**What:** Keep camera as serializable state (`zoom`, `offsetX`, `offsetY`) and map pointer input through inverse transforms before resolving cells.
**When to use:** Any pointer-driven action (`paint`, `template select`, `destroy select`) after camera movement.
**Example:**

```typescript
// Source: apps/web/src/client.ts (current pointer mapping baseline)
function pointerToCell(event: PointerEvent): Cell | null {
  const rect = canvas.getBoundingClientRect();
  const canvasX = event.clientX - rect.left;
  const canvasY = event.clientY - rect.top;
  const worldX = (canvasX - camera.offsetX) / camera.zoom;
  const worldY = (canvasY - camera.offsetY) / camera.zoom;
  const x = Math.floor(worldX / cellSize);
  const y = Math.floor(worldY / cellSize);
  // bounds checks...
}
```

### Pattern 2: Cursor-Anchored Zoom

**What:** Adjust offset while changing zoom so the world point under the cursor remains stable.
**When to use:** Mouse wheel and trackpad pinch wheel events.
**Example:**

```typescript
// Source model: cursor-anchored zoom requirement from 11-CONTEXT.md
const worldAtCursorX = (cursorX - camera.offsetX) / camera.zoom;
const worldAtCursorY = (cursorY - camera.offsetY) / camera.zoom;
const nextZoom = clampZoom(camera.zoom * zoomFactor);

camera.offsetX = cursorX - worldAtCursorX * nextZoom;
camera.offsetY = cursorY - worldAtCursorY * nextZoom;
camera.zoom = nextZoom;
```

### Pattern 3: Shared Union-Zone Contributor Projection

**What:** Build contributor centers from structure anchor + transformed dimensions and evaluate coverage with existing radius/shape constants.
**When to use:** Build preview legality checks and client overlay projection.
**Example:**

```typescript
// Source: packages/rts-engine/rts.ts (current contributor semantics)
contributors.push({
  centerX: structure.x + Math.floor(structure.width / 2),
  centerY: structure.y + Math.floor(structure.height / 2),
});
```

### Pattern 4: Explicit Render Pass Ordering

**What:** Separate board draw into deterministic passes instead of one blended overlay function.
**When to use:** Always-visible zone plus placement overlays with priority rules.
**Example:**

```typescript
renderTerrainAndGrid();
renderUnionBuildZone();
renderStructurePass();
renderBuildPreviewOverlay(); // includes invalid cells + ghost
```

### Anti-Patterns to Avoid

- **Direct CSS zoom without inverse hit-testing:** causes placement and destroy picks to drift at non-default zoom.
- **Zone projection from non-authoritative local intent:** must derive from authoritative `state` structures, not pending local guesses.
- **Recomputing full zone geometry on every pointermove:** expensive and unnecessary; recompute on authoritative structure changes.
- **Hard clamping pan to map edges in this phase:** contradicts locked decision allowing outside-margin movement.

## Don't Hand-Roll

| Problem                                        | Don't Build                                        | Use Instead                             | Why                                                                                     |
| ---------------------------------------------- | -------------------------------------------------- | --------------------------------------- | --------------------------------------------------------------------------------------- |
| Camera state scattered across event handlers   | Ad hoc mutable booleans in `client.ts`             | Pure `camera-view-model.ts` helpers     | Keeps coordinate conversions deterministic and testable.                                |
| Duplicate union-zone math in multiple runtimes | Separate hand-coded radius logic in web and engine | Shared `#rts-engine` build-zone helper  | Prevents legality/render drift and keeps constants centralized.                         |
| Device-specific pinch branching                | Browser-conditional gesture implementations        | Wheel normalization + keyboard fallback | Simpler cross-device behavior while still satisfying wheel/pinch/keyboard requirements. |

**Key insight:** Phase 11 is primarily a coordinate-system and rendering-order correctness phase; correctness comes from shared math and explicit layering, not from new gameplay rules.

## Common Pitfalls

### Pitfall 1: Pointer targeting drifts after zoom

**What goes wrong:** Clicked cells do not match highlighted/selected cells at non-default zoom.
**Why it happens:** Pointer mapping ignores camera offset/zoom and uses only raw `cellSize` division.
**How to avoid:** Route all pointer-to-cell conversion through inverse camera transform helpers.
**Warning signs:** Destroy or build selection appears one or more cells away from cursor intent.

### Pitfall 2: Right-drag pan opens context menu and breaks capture

**What goes wrong:** Right mouse drag intermittently stops panning or opens browser context menu.
**Why it happens:** Missing `contextmenu` suppression and inconsistent pointer-capture release.
**How to avoid:** Prevent context menu on board interaction and always release capture on pointer end/cancel.
**Warning signs:** Camera snaps/stalls during drag.

### Pitfall 3: Wheel zoom feels inconsistent across devices

**What goes wrong:** Trackpad zoom steps feel too large or too small versus mouse wheel.
**Why it happens:** Raw wheel delta is applied directly without normalization/clamping.
**How to avoid:** Normalize delta to bounded zoom factors and clamp to `0.45x-1.6x` every update.
**Warning signs:** Sudden jump-to-min/max zoom on single gesture.

### Pitfall 4: Zone overlay lags behind structure changes

**What goes wrong:** Zone outline still shows old contributors briefly after destroy/build resolves.
**Why it happens:** Overlay caches are not refreshed on authoritative `state` updates.
**How to avoid:** Recompute local-team contributors whenever structures in latest authoritative state change.
**Warning signs:** Player can queue legally but overlay still appears out-of-date.

### Pitfall 5: Invalid placement feedback loses visual priority

**What goes wrong:** Red illegal cells are muted or hidden by zone fill/outline.
**Why it happens:** Overlay draw order puts zone above preview highlights.
**How to avoid:** Keep invalid-cell and ghost preview render pass last.
**Warning signs:** Users report unclear reason for `outside build zone` rejection.

## Code Examples

Verified patterns from current sources:

### Existing pointer-to-cell baseline (needs camera-aware inverse transform)

```typescript
// Source: apps/web/src/client.ts:1834
function pointerToCell(event: PointerEvent): Cell | null {
  const rect = canvas.getBoundingClientRect();
  const x = Math.floor((event.clientX - rect.left) / cellSize);
  const y = Math.floor((event.clientY - rect.top) / cellSize);
  if (x < 0 || y < 0 || x >= gridWidth || y >= gridHeight) return null;
  return { x, y };
}
```

### Authoritative structure projection already available for zone contributors

```typescript
// Source: apps/web/src/client.ts:771
function syncVisibleStructures(payload: StatePayload): void {
  const nextStructures: VisibleStructure[] = [];
  // ...populate from authoritative payload.teams[].structures
  visibleStructures = nextStructures;
}
```

### Engine legality currently uses contributor-center union checks

```typescript
// Source: packages/rts-engine/rts.ts:847
function collectBuildZoneContributors(room: RoomState, team: TeamState) {
  // centerX/centerY derived from transformed structure dimensions
}
```

## State of the Art

| Old Approach                                                      | Current Approach                                                             | When Changed    | Impact                                                               |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------------- | --------------- | -------------------------------------------------------------------- |
| Fixed canvas with no camera state                                 | Camera state helper with pan/zoom/reset and inverse hit-testing              | Phase 11 target | Enables map navigation while preserving placement/destroy precision. |
| Build-zone visibility only via preview rejection (`illegalCells`) | Always-visible local-team union-zone fill+outline, stronger during placement | Phase 11 target | Makes legal territory legible before queue attempts.                 |
| Inline contributor logic inside `rts.ts` only                     | Shared build-zone helper reused by engine legality and web overlay           | Phase 11 target | Reduces parity drift between authoritative checks and visuals.       |

**Deprecated/outdated:**

- Implicit assumption that `pointerToCell` can use fixed `cellSize` math independent of viewport transforms.
- One-pass overlay rendering that does not separate zone/preview visual priority.

## Open Questions

1. **Should inactive-but-not-destroyed structures contribute to the visualized zone?**
   - What we know: Current engine contributor filtering checks `hp > 0` (not `active`) before contributing.
   - What's unclear: Whether UX should hide contributors with integrity-disabled activity states.
   - Recommendation: Match current engine legality semantics exactly for this phase to avoid parity drift.

2. **What is the best `F` reset target for spectators (`teamId === null`)?**
   - What we know: Locked decision defines reset to player base.
   - What's unclear: Spectator fallback when no local team exists.
   - Recommendation: Reset to map center for spectators and to local base center for active players.

3. **Keyboard pan speed should be zoom-scaled or world-space constant?**
   - What we know: Input support is locked, exact speed is discretionary.
   - What's unclear: Which mode feels more consistent across zoom levels.
   - Recommendation: Use world-space constant speed first; adjust after manual UX pass if it feels too slow at max zoom.

## Sources

### Primary (HIGH confidence)

- `.planning/phases/11-camera-and-build-zone-visualization/11-CONTEXT.md` - Locked interaction and rendering decisions.
- `.planning/ROADMAP.md` - Phase goal, dependency, and success criteria.
- `.planning/REQUIREMENTS.md` - UI-02/UI-05 requirement definitions.
- `apps/web/src/client.ts` - Current render loop, pointer mapping, and authoritative state wiring.
- `apps/web/index.html` - Current canvas layout and in-game control composition.
- `packages/rts-engine/rts.ts` - Authoritative build-zone contributor semantics and legality checks.
- `packages/rts-engine/gameplay-rules.ts` - Canonical build-zone radius and distance shape constants.

### Secondary (MEDIUM confidence)

- None.

### Tertiary (LOW confidence)

- None.

## Metadata

**Confidence breakdown:**

- Standard stack: HIGH - built entirely on existing repository stack and browser platform primitives already in use.
- Architecture: MEDIUM - helper boundaries and layering strategy are clear, but final UX tuning values are discretionary.
- Pitfalls: HIGH - each maps to concrete current code paths (`pointerToCell`, render ordering, state sync lifecycle).

**Research date:** 2026-03-02
**Valid until:** 2026-04-01
