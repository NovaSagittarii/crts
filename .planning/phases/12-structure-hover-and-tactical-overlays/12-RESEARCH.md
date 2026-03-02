# Phase 12: Structure Hover and Tactical Overlays - Research

**Researched:** 2026-03-02
**Domain:** Structure inspection interaction state, tactical overlay composition, and authoritative UI synchronization
**Confidence:** MEDIUM

<user_constraints>

## User Constraints (from CONTEXT.md)

### Locked Decisions

### Hover interaction model

- Hover shows ephemeral preview; click/tap pins the structure for stable interaction.
- Actions appear only when structure is pinned/selected (not on hover).
- Brief grace delay (~300ms) when cursor leaves structure, unless pinned, to prevent flicker when scanning nearby cells.
- Single active structure at a time (no compare mode).

### Overlay layout around grid

- Default layout uses a fixed side rail next to grid with stacked sections (Economy, Build, Team).
- Rail composition must stay flexible so sections can be added or reordered later.
- Desktop behavior keeps collapsible sections in a persistent rail.
- Small screens use a tabbed drawer for Economy/Build/Team switching.
- Spacing should maintain clear containment without visual clutter.

### Information density and update behavior

- Pinned structure panel defaults to tactical summary: owner, HP/integrity, current state, available actions.
- Overlays show key metrics first with expandable details.
- Live updates are immediate with subtle delta highlight around one second.
- Show a small syncing hint only when data is delayed.

### Action feedback style

- Pending actions show immediate optimistic UI with small spinner/pending badge.
- Authoritative results appear near the interaction source (pinned panel or overlay section).
- Rejected actions show inline message with reason and quick dismiss.
- Error text remains player-friendly, not raw reason codes.

### OpenCode's Discretion

- Exact grace-delay value (target ~300ms).
- Delta highlight visual details (color and animation style).
- Syncing indicator visual treatment.
- Touch pin/unpin gesture details.

### Deferred Ideas (OUT OF SCOPE)

- None.

</user_constraints>

<phase_requirements>

## Phase Requirements

| ID    | Description                                                                                             | Research Support                                                                                                                                    |
| ----- | ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| UI-03 | Player can hover a structure to view details and available actions.                                     | Add deterministic hover/pin state helpers with leave-grace handling, then render pinned structure details/actions in a dedicated inspector surface. |
| UI-04 | Player can access economy, build options, and team information in grid-adjacent overlays while playing. | Add a tactical rail (desktop) and tabbed drawer (mobile) fed from authoritative `state` plus existing preview/destroy feedback channels.            |

</phase_requirements>

## Summary

Phase 11 already established the hard part for pointer precision: `client.ts` uses camera-aware `pointerToCell` conversion and tracks authoritative visible structures through `syncVisibleStructures`. That means Phase 12 should build interaction behavior on top of existing cell-to-structure lookup, instead of introducing a second spatial path. The current destroy flow is click-select only and tied to one control block, so hover/pin behavior should be layered as a thin state model that feeds the same authoritative destroy pipeline.

The current in-match UI puts economy, build, and destroy controls in a single left control card, while the board sits in a separate shell. To satisfy the phase boundary, tactical information should move closer to the grid in a dedicated adjacent surface. Desktop can use a persistent rail with collapsible sections; mobile should switch to tabbed drawer sections so gameplay remains visible while preserving quick access to Economy/Build/Team data.

Authoritative synchronization is already available through `state`, `build:preview`, `build:queued`, `build:outcome`, `destroy:queued`, and `destroy:outcome` listeners. The safest approach is to keep all inspector/overlay content derived from those channels and avoid any client-side simulation. Subtle delta emphasis and syncing hints can be handled as short-lived UI projection state (timestamped highlights and reconnect-derived syncing flags), not as gameplay state.

**Primary recommendation:** Add two pure helper modules (`structure-interaction-view-model.ts` and `tactical-overlay-view-model.ts`) with deterministic tests first, then wire them into `client.ts` and `index.html` to deliver hover/pin inspector behavior and adjacent tactical overlays across desktop and mobile layouts.

## Standard Stack

### Core

| Library / Platform                         | Version    | Purpose                                                       | Why Standard                                                                                            |
| ------------------------------------------ | ---------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Browser Pointer + Keyboard Events          | platform   | Hover/pin interactions and tab/drawer controls                | Existing runtime already uses pointer and keyboard handlers for camera and board interaction.           |
| Canvas 2D + DOM overlay surfaces           | platform   | Keep board rendering in canvas while tactical UI stays in DOM | Matches current architecture (`canvas` for grid, HTML controls for HUD/actions) with no new dependency. |
| `#rts-engine` payload types and structures | repo-local | Authoritative structure/team/economy projection               | Existing wire contract already carries structure, income, pending build, and pending destroy data.      |
| TypeScript strict mode                     | `5.4.5`    | Deterministic helper APIs and event-safe state projection     | Reduces drift and keeps helper contracts explicit for runtime wiring.                                   |

### Supporting

| Library / Pattern               | Version    | Purpose                             | When to Use                                                                                |
| ------------------------------- | ---------- | ----------------------------------- | ------------------------------------------------------------------------------------------ |
| `vitest`                        | `1.6.0`    | Fast deterministic helper tests     | Validate hover grace, pin semantics, section projection, and delta highlight expiry logic. |
| Existing web view-model pattern | repo-local | Keep `client.ts` orchestration thin | Mirror `camera-view-model` and `destroy-view-model` style for pure reducer-style helpers.  |

### Alternatives Considered

| Instead of                                      | Could Use                                           | Tradeoff                                                                                                      |
| ----------------------------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Pure helper reducers for hover/pin and overlays | Inline state mutations spread through `client.ts`   | Faster initially, but high drift risk and poor testability for grace-delay and synchronization edge cases.    |
| Adjacent tactical rail + mobile tabs            | Floating modal/popover inspector only               | Popovers reduce persistent context and clash with camera movement; harder to keep economy/build/team visible. |
| Authoritative payload projection                | Client-side extrapolation of economy/pending states | Can feel snappier but violates server-authoritative UI reliability constraints and increases desync risk.     |

**Installation:**

```bash
# No new dependencies required for Phase 12.
npm install
```

## Architecture Patterns

### Recommended Project Structure

```text
apps/web/
├── index.html                                  # Tactical rail and mobile tabbed drawer markup/styles
└── src/
    ├── client.ts                               # Runtime wiring for hover/pin, overlays, and feedback
    ├── structure-interaction-view-model.ts     # NEW: pure hover/pin/grace state helpers
    └── tactical-overlay-view-model.ts          # NEW: pure projection helpers for Economy/Build/Team surfaces

tests/web/
├── structure-interaction-view-model.test.ts    # NEW: deterministic hover/pin transition coverage
└── tactical-overlay-view-model.test.ts         # NEW: deterministic overlay projection and highlight coverage
```

### Pattern 1: Hover -> Grace -> Pin state machine

**What:** Use one interaction state with a single active structure key and explicit transitions for hover enter/leave, grace timeout, pin, unpin, and authoritative invalidation.
**When to use:** Pointer move/leave/click and authoritative structure updates.
**Example:**

```typescript
const next = reduceStructureInteraction(state, {
  type: 'hover-leave',
  atMs: now,
  graceMs: 300,
});
```

### Pattern 2: Authoritative structure projection first, UI projection second

**What:** Build inspector/overlay content from `visibleStructures`, local team payloads, preview payloads, and destroy pending/outcome events.
**When to use:** Every `state` update and every queue/outcome listener.
**Example:**

```typescript
const tactical = deriveTacticalOverlayState({
  team: localTeam,
  templates: availableTemplates,
  preview: latestBuildPreview,
  destroy: destroyViewState,
  nowMs: Date.now(),
});
```

### Pattern 3: Split render responsibility between board canvas and adjacent tactical surfaces

**What:** Keep board interactions on canvas while rendering inspector and Economy/Build/Team sections in DOM.
**When to use:** Always; avoid drawing textual tactical UI in canvas.
**Example:**

```typescript
render(); // canvas board
renderStructureInspector(inspectorState);
renderTacticalOverlay(overlayState);
```

### Pattern 4: Local optimistic hint + authoritative final feedback

**What:** Show immediate pending badge/spinner after action emission, then replace with authoritative queued/outcome messages.
**When to use:** Build queue and destroy queue interactions triggered from pinned inspector actions.
**Example:**

```typescript
setInspectorFeedback('Destroy queued...', { pending: true });
// Later from socket outcome:
setInspectorFeedback('Structure destroyed.', { pending: false });
```

### Anti-Patterns to Avoid

- Clearing hover immediately on pointer jitter, which causes flicker while scanning adjacent structure cells.
- Showing actionable buttons for unpinned hover-only states (contradicts locked decision).
- Deriving tactical metrics from local assumptions instead of authoritative payload fields.
- Mixing board-space transform math into DOM overlay layout calculations.
- Adding new gameplay mutation event types for this phase instead of reusing existing queue actions.

## Don't Hand-Roll

| Problem                                           | Do Not Build                                          | Use Instead                                          | Why                                                                |
| ------------------------------------------------- | ----------------------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------ |
| Hover/pin lifecycle across noisy pointer movement | Ad hoc booleans and manual timeout scatter in runtime | Pure `structure-interaction-view-model` reducer      | Deterministic behavior with direct test coverage for grace timing. |
| Tactical section projection                       | Hand-assembled DOM copy in multiple functions         | Single `tactical-overlay-view-model` projection path | Keeps Economy/Build/Team copy aligned and easier to evolve.        |
| Action feedback reason formatting                 | Raw `reason` code strings in UI                       | Existing user-friendly reason mappers in `client.ts` | Preserves educational player-facing language.                      |
| Sync lag indication                               | Permanent reconnect badge for all active sessions     | Contextual syncing hint gated by reconnect/lag state | Prevents noisy UI while still communicating delayed data windows.  |

## Common Pitfalls

### Pitfall 1: Hover flicker when crossing dense footprints

**What goes wrong:** Inspector disappears/reappears while moving between neighboring structure cells.
**Why it happens:** Hover state clears immediately on leave events.
**How to avoid:** Keep grace timeout (~300ms) and cancel it on re-entry or pin.
**Warning sign:** Rapid pointer movement causes repeated empty inspector state.

### Pitfall 2: Pinned structure references stale key after destroy

**What goes wrong:** Inspector keeps showing actions for a structure already removed by authoritative updates.
**Why it happens:** Pin state is not reconciled against latest `visibleStructures` map.
**How to avoid:** Invalidate pinned key on each `syncVisibleStructures` refresh when key is absent.
**Warning sign:** Destroyed structure remains selectable in panel copy.

### Pitfall 3: Overlay values drift from authoritative state

**What goes wrong:** Economy/build/team cards show stale values after reconnect or fast tick updates.
**Why it happens:** Overlay model caches local snapshots without timestamped refresh policy.
**How to avoid:** Re-derive overlay state from each authoritative payload and gate sync hints to delayed windows only.
**Warning sign:** Card values diverge from top header stats.

### Pitfall 4: Mobile drawer blocks core gameplay controls

**What goes wrong:** On small screens, overlay panels cover queue/destroy controls with no quick switch.
**Why it happens:** Desktop rail pattern copied directly to mobile.
**How to avoid:** Use tabbed drawer sections with compact toggles and preserve board visibility priority.
**Warning sign:** Mobile users cannot inspect board and overlays in quick sequence.

### Pitfall 5: Action feedback gets swallowed by global message churn

**What goes wrong:** Structure-level queued/rejected messages disappear under unrelated status updates.
**Why it happens:** All feedback goes through a single global message line.
**How to avoid:** Keep source-local inline feedback in inspector/overlay surfaces while still posting to global status/toasts.
**Warning sign:** Players report "action happened but no clear local confirmation."

## Code Examples

Verified patterns from current sources:

### Existing authoritative structure projection cache

```typescript
// Source: apps/web/src/client.ts
function syncVisibleStructures(payload: StatePayload): void {
  const nextIndex = new Map<string, VisibleStructure>();
  // populate from payload.teams[].structures
  structureCellIndex = nextIndex;
}
```

### Existing destroy selection path that should become pin-aware

```typescript
// Source: apps/web/src/client.ts
if (selectDestroyStructureAtCell(cell)) {
  updateDestroyUi();
  return;
}
```

### Existing economy/team data projection entry point

```typescript
// Source: apps/web/src/client.ts
function updateTeamStats(payload: StatePayload): void {
  syncCurrentTeamIdFromState(payload);
  // resources, income, base status, and HUD synchronization
}
```

## Open Questions

1. **Exact grace timeout value for hover leave**
   - Recommendation: start at `300ms`, tune between `250-350ms` only if manual feel check shows sticky hover.

2. **Syncing hint trigger threshold**
   - Recommendation: show hint only when reconnect is pending or when last authoritative tick age exceeds one render second.

3. **Touch unpin interaction**
   - Recommendation: single tap pins, second tap on same structure unpins, tap empty board clears unless pending confirmation is active.

4. **Delta highlight style**
   - Recommendation: subtle border/label flash for about `1000ms`; avoid large background transitions that compete with error/pending colors.

## Sources

### Primary (HIGH confidence)

- `.planning/phases/12-structure-hover-and-tactical-overlays/12-CONTEXT.md` - locked UX decisions and scope boundaries.
- `.planning/ROADMAP.md` - phase goal, requirements, and success criteria.
- `.planning/REQUIREMENTS.md` - UI-03/UI-04 requirement definitions.
- `apps/web/src/client.ts` - current camera-aware board interaction, structure indexing, and action feedback wiring.
- `apps/web/index.html` - current in-match panel layout, board shell, and responsive breakpoints.
- `apps/web/src/destroy-view-model.ts` - existing deterministic action-selection state pattern.
- `apps/web/src/economy-view-model.ts` - existing deterministic HUD projection helper pattern.
- `packages/rts-engine/socket-contract.ts` - authoritative payload surfaces available to overlays.

### Secondary (MEDIUM confidence)

- `tests/web/destroy-view-model.test.ts` and `tests/web/economy-view-model.test.ts` - helper testing style and deterministic assertion patterns.

### Tertiary (LOW confidence)

- None.

## Metadata

**Confidence breakdown:**

- Interaction-state architecture: HIGH - directly grounded in existing helper/reducer patterns.
- Overlay layout strategy: MEDIUM - structural fit is clear, but desktop/mobile tuning remains discretionary.
- Pitfall coverage: MEDIUM - mapped to existing runtime flows, but final UX polish requires implementation verification.

**Research date:** 2026-03-02
**Valid until:** 2026-04-01
