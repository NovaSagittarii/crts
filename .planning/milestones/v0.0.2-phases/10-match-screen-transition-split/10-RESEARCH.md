# Phase 10: Match Screen Transition Split - Research

**Researched:** 2026-03-02
**Domain:** Authoritative lobby/in-game screen routing and reconnect-safe UI transitions
**Confidence:** MEDIUM

<user_constraints>

## User Constraints (from CONTEXT.md)

### Locked Decisions

### Status-to-screen mapping

- `countdown` stays on the lobby screen as a pre-match state.
- `finished` first shows an in-game results view; return to lobby is host-driven.
- Screen switches are triggered by server-authoritative match-state events only.
- No local screen override mode; clients follow authoritative state strictly.

### Screen composition and layout

- Lobby screen keeps full pre-match controls: slot claim, ready toggle, host start, roster, and spectators.
- In-game screen hides lobby-only controls completely.
- Chat is available on both screens and is docked on the right side.
- A shared status strip is visible on both screens and placed along screen edges.
- Both screen modes should require minimal scrolling; key actions and state should stay readily visible.

### Transition behavior and interruption rules

- Use a short fade transition (`~150-250ms`) for lobby/in-game screen switches.
- Do not force focus changes when states switch.
- If a switch occurs while chat input is in progress, preserve unsent draft text.
- Show a compact edge banner for `~2-3s` on state changes, with status strip updates.

### Reconnect landing and messaging

- Authoritative reconnect landing map: `lobby`/`countdown` -> lobby screen, `active`/`finished` -> in-game screen.
- Show a short neutral confirmation message: "Reconnected. Synced to match state."
- Reconnect notice auto-hides after `~2-3s`.
- While syncing, show a brief edge indicator ("Reconnecting / syncing...") before final screen resolution.

### OpenCode's Discretion

- Exact responsive breakpoints and edge positioning details for right-docked chat and shared status strip.
- Exact visual styling of the compact edge banner and reconnect/sync indicator.
- Exact implementation details of the short fade, as long as duration remains within the agreed range.

### Deferred Ideas (OUT OF SCOPE)

None — discussion stayed within phase scope.

</user_constraints>

<phase_requirements>

## Phase Requirements

| ID    | Description                                                                                                                      | Research Support                                                                                                                                                                                                                                           |
| ----- | -------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| UI-01 | Player transitions between lobby and in-game screens through explicit match-state transitions (no combined dual-purpose screen). | Use server-authoritative `RoomStatus` as the only route source, split `apps/web/index.html` into dedicated lobby and in-game containers, and add reconnect-first status resolution so reconnect landings map to the current authoritative lifecycle state. |

</phase_requirements>

## Summary

The current web client is a single dual-purpose screen: lobby controls, gameplay controls, board, and chat all render together in one layout, then sections are made read-only based on lifecycle state. That does not satisfy UI-01 or the Phase 10 constraints that require a dedicated pre-match lobby screen and a dedicated in-game screen. The highest-risk gap is that `room:joined` currently forces `applyRoomStatus('lobby')` before membership sync arrives, which can briefly show the wrong screen during reconnect into active/finished matches.

The architecture already has the right authoritative signals for this phase. Server lifecycle transitions are canonical (`lobby -> countdown -> active -> finished`) and are broadcast through `room:membership.status`, `room:countdown`, `room:match-started`, and `room:match-finished`. Integration tests already verify reconnect and status convergence, so Phase 10 should build UI routing on these signals instead of introducing client-side lifecycle inference.

Use a strict status-to-screen mapping and remove all local override pathways (notably finished "lobby view" toggles). Keep chat and status strip as shared shell elements across both screens so draft text survives transitions and edge messaging stays consistent. Implement transitions with lightweight CSS fades in the required 150-250ms range.

**Primary recommendation:** Build a small match-screen view-model in `apps/web/src` that maps authoritative `RoomStatus` to `lobby` or `ingame`, drives transition banners/reconnect-sync UX, and becomes the only pathway that toggles visible screens.

## Standard Stack

### Core

| Library                          | Version           | Purpose                                                                              | Why Standard                                                                                 |
| -------------------------------- | ----------------- | ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| `#rts-engine` socket contract    | repo-local        | Defines authoritative `RoomStatus` and lifecycle payloads shared by server/web/tests | Prevents status taxonomy drift and keeps UI routing aligned with server authority.           |
| `socket.io` + `socket.io-client` | `4.7.5` + `4.8.3` | Lifecycle event transport and reconnect behavior                                     | Guarantees ordered delivery while requiring authoritative resync handling for missed events. |
| `typescript`                     | `5.4.5`           | Strongly typed screen-route and event handling logic                                 | Prevents accidental local-only screen modes from bypassing authoritative state mapping.      |
| `vite` + vanilla DOM             | `5.2.0`           | Existing web runtime and build pipeline                                              | Fits current app architecture; no framework migration needed for this phase.                 |

### Supporting

| Library                                                                                  | Version    | Purpose                               | When to Use                                                                                     |
| ---------------------------------------------------------------------------------------- | ---------- | ------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `vitest`                                                                                 | `1.6.0`    | Unit/integration regression checks    | Add/extend web reducer tests and integration assertions for lifecycle/reconnect screen mapping. |
| Existing web view-model pattern (`destroy-view-model`, `placement-transform-view-model`) | repo-local | Pure state reducers with direct tests | Mirror this pattern for a `match-screen-view-model` to keep `client.ts` manageable.             |

### Alternatives Considered

| Instead of                                      | Could Use                           | Tradeoff                                                                      |
| ----------------------------------------------- | ----------------------------------- | ----------------------------------------------------------------------------- |
| Authoritative status mapping from server events | Local UI toggles or client timers   | Violates locked decision (no local override) and risks reconnect divergence.  |
| CSS class-based fades                           | JS animation timeline/state machine | Adds complexity without benefit for a simple 150-250ms two-screen transition. |
| Shared chat shell across both screens           | Separate chat inputs per screen     | Increases draft-loss risk when screens mount/unmount.                         |

**Installation:**

```bash
# No new dependencies are required for Phase 10.
npm install
```

## Architecture Patterns

### Recommended Project Structure

```text
apps/web/
├── index.html                         # Split lobby/in-game screen containers + shared right-docked chat/status strip
└── src/
    ├── client.ts                      # Event wiring and DOM updates; consumes screen view-model
    └── match-screen-view-model.ts     # NEW: authoritative status->screen mapping + transition/reconnect notice state

tests/
├── web/match-screen-view-model.test.ts  # NEW: pure reducer tests for mapping, banner timing state, draft-preservation rules
└── integration/server/match-lifecycle.test.ts  # Extend only if lifecycle/reconnect event assertions need tightening
```

### Pattern 1: Authoritative Status-Driven Screen Routing

**What:** Derive current screen strictly from authoritative `RoomStatus` (`lobby/countdown -> lobby`, `active/finished -> ingame`).
**When to use:** Any screen visibility change, including reconnect and finished-state rendering.
**Example:**

```typescript
// Source: apps/web/src/client.ts, packages/rts-engine/socket-contract.ts
function resolveScreen(status: RoomStatus): 'lobby' | 'ingame' {
  return status === 'active' || status === 'finished' ? 'ingame' : 'lobby';
}

function applyAuthoritativeStatus(status: RoomStatus): void {
  currentRoomStatus = status;
  setVisibleScreen(resolveScreen(status));
}
```

### Pattern 2: Shared Shell, Split Content

**What:** Keep chat + edge status strip mounted outside lobby/in-game panels; only panel content switches.
**When to use:** Preserve chat drafts, avoid focus disruption, and keep shared lifecycle messaging visible across screens.
**Example:**

```typescript
// Source: apps/web/index.html (chat currently single-instance), Phase 10 constraints
// Keep one persistent chat input element and avoid replacing it during screen switches.
const chatDraft = chatInputEl.value;
setVisibleScreen(nextScreen);
chatInputEl.value = chatDraft;
```

### Pattern 3: Event-Triggered Transition Coordinator

**What:** Apply a short CSS fade and compact edge banner only when authoritative status changes.
**When to use:** `room:membership` status updates and explicit lifecycle events (`room:countdown`, `room:match-started`, `room:match-finished`).
**Example:**

```typescript
// Source: apps/web/src/client.ts (applyRoomStatus/updateLifecycleUi), apps/web/index.html (180ms transitions)
if (previousStatus !== nextStatus) {
  showEdgeBanner(getLifecycleLabel(nextStatus), 2400);
  rootEl.classList.add('screen-fade');
}
applyAuthoritativeStatus(nextStatus);
```

### Pattern 4: Reconnect-First Status Resolution

**What:** Show a brief syncing indicator until first authoritative post-reconnect membership/status resolves the screen.
**When to use:** Any disconnect/reconnect path before membership/state re-sync is confirmed.
**Example:**

```typescript
// Source: apps/web/src/client.ts (pendingReconnectSyncNotice)
pendingReconnectSyncNotice = true;
showEdgeBanner('Reconnecting / syncing...', 3000);

socket.on('room:membership', (payload) => {
  applyAuthoritativeStatus(payload.status);
  if (pendingReconnectSyncNotice) {
    pendingReconnectSyncNotice = false;
    showEdgeBanner('Reconnected. Synced to match state.', 2400);
  }
});
```

### Anti-Patterns to Avoid

- **Local screen override controls:** remove local finished/lobby toggle pathways (`isFinishedLobbyView`) to honor strict authoritative routing.
- **Defaulting reconnect to lobby before status sync:** avoid `applyRoomStatus('lobby')` flashes after `room:joined` when room is actually active/finished.
- **Mount/unmount chat input per screen:** this risks unsent draft loss and accidental focus changes.
- **Driving transitions from non-authoritative local actions:** emit requests (`room:start`, etc.) but switch screens only on authoritative lifecycle state.

## Don't Hand-Roll

| Problem                           | Don't Build                          | Use Instead                                                    | Why                                                                                                        |
| --------------------------------- | ------------------------------------ | -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Lifecycle route inference         | Client timer-based screen switching  | `RoomStatus` mapping from authoritative server payloads        | Prevents countdown/active race bugs and reconnect mismatches.                                              |
| Reconnect event replay            | Custom client-side replay cache      | Existing authoritative `room:membership` + `state` resync loop | Socket.IO is at-most-once by default; replay belongs at app/server persistence layer, not ad-hoc UI cache. |
| Complex transition runtime        | Custom JS animation state machine    | CSS class-based fade transitions (150-250ms)                   | Meets UX requirement with lower complexity and fewer timing edge cases.                                    |
| Duplicate cross-screen chat state | Separate chat controllers per screen | Single shared chat component/state in shell                    | Preserves draft text and avoids focus churn between transitions.                                           |

**Key insight:** Phase 10 is primarily a routing-authority refactor (single source of truth for screen mode), not a gameplay logic change.

## Common Pitfalls

### Pitfall 1: Reconnect briefly shows wrong screen

**What goes wrong:** Reconnecting users flash into lobby before being moved to active/finished.
**Why it happens:** Client applies local default lobby state on join before authoritative membership status arrives.
**How to avoid:** Treat reconnect as unresolved until first post-reconnect authoritative status update, then resolve screen once.
**Warning signs:** Reports of "lobby flash" when reconnecting into active matches.

### Pitfall 2: Finished-state local toggle bypasses authority

**What goes wrong:** Users can force lobby-like view while server still reports `finished`.
**Why it happens:** Local UI mode flags (`isFinishedLobbyView`) exist outside lifecycle authority model.
**How to avoid:** Remove local override; map `finished` to in-game results screen only.
**Warning signs:** UI and lifecycle status strip disagree on current mode.

### Pitfall 3: Chat draft is lost during transitions

**What goes wrong:** In-progress message text disappears when switching screens.
**Why it happens:** Chat input gets remounted/replaced or reset on status changes.
**How to avoid:** Keep one persistent input node and preserve value across DOM class toggles.
**Warning signs:** User starts typing in countdown and draft is empty after active transition.

### Pitfall 4: Screen change happens on intent, not authority

**What goes wrong:** UI switches immediately on `room:start` click before server confirms status transition.
**Why it happens:** Client ties routing to emitted actions instead of received lifecycle state.
**How to avoid:** Route only on authoritative status payloads/events.
**Warning signs:** Non-host clients briefly show countdown/active despite `room:error:not-host`.

### Pitfall 5: Transition/banner timing drifts across handlers

**What goes wrong:** Duplicate banners or overlapping fades from `room:membership` plus lifecycle events.
**Why it happens:** Multiple handlers each trigger visual transitions without dedupe.
**How to avoid:** Centralize status-change handling with previous/next status comparison and deduplicated banner dispatch.
**Warning signs:** Back-to-back toasts/banners for a single lifecycle change.

## Code Examples

Verified patterns from current sources:

### Server emits authoritative lifecycle state

```typescript
// Source: apps/server/src/server.ts:936
const transition = transitionMatchLifecycle(room.status, 'countdown-complete');
if (!transition.allowed) {
  return;
}

room.status = transition.nextStatus;
emitMembership(room);
io.to(roomChannel(room.state.id)).emit('room:match-started', {
  roomId: room.state.id,
});
```

### Client already consumes authoritative membership status

```typescript
// Source: apps/web/src/client.ts:1901
function renderLobbyMembership(payload: RoomMembershipPayload): void {
  currentMembership = payload;
  currentRoomCode = payload.roomCode;
  roomCodeEl.textContent = payload.roomCode;
  applyRoomStatus(payload.status);
  // ...render membership UI...
}
```

### Reconnect notice hook exists and can be upgraded for Phase 10 copy

```typescript
// Source: apps/web/src/client.ts:2509
if (pendingReconnectSyncNotice) {
  pendingReconnectSyncNotice = false;
  addToast('Reconnected, state synced.');
}
```

## State of the Art

| Old Approach                                               | Current Approach                                                                         | When Changed    | Impact                                                   |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------- | --------------- | -------------------------------------------------------- |
| Single dual-purpose controls screen with read-only toggles | Dedicated lobby screen and dedicated in-game screen                                      | Phase 10 target | Satisfies UI-01 and removes mode ambiguity.              |
| Optional local finished "Return to Lobby View" override    | No local override; `finished` remains in-game results view                               | Phase 10 target | Keeps screen state aligned with authoritative lifecycle. |
| Reconnect toast from first state payload only              | Explicit syncing indicator + authoritative status resolution + neutral confirmation copy | Phase 10 target | Reduces reconnect confusion and wrong-screen flashes.    |

**Deprecated/outdated:**

- `isFinishedLobbyView` local mode override in `apps/web/src/client.ts`.
- Immediate local `applyRoomStatus('lobby')` assumptions on join/reconnect paths.
- Combined layout that keeps lobby-only controls visible during active gameplay.

## Open Questions

1. **Should `room:joined` include authoritative status to reduce unresolved time?**
   - What we know: `RoomJoinedPayload` currently omits status; membership arrives immediately after join in current server flow.
   - What's unclear: Whether very slow networks can still produce visible unresolved windows.
   - Recommendation: Keep membership as source of truth first; only extend `RoomJoinedPayload` if unresolved windows remain observable after Phase 10 split.

2. **Exact edge layout at mobile breakpoints for right-docked chat/status strip**
   - What we know: Constraint locks right-docked chat and edge strip on both screens with minimal scrolling.
   - What's unclear: Pixel breakpoints and stacking behavior below ~720px.
   - Recommendation: Define 2-3 explicit breakpoints and include viewport snapshots in phase verification notes.

3. **Banner dedupe policy between `room:membership` and lifecycle event handlers**
   - What we know: Both channels can represent the same lifecycle transition.
   - What's unclear: Final dedupe key choice (`previousStatus -> nextStatus` or event sequence id).
   - Recommendation: Centralize transition dispatch in one function keyed by status delta to prevent duplicate banners.

## Sources

### Primary (HIGH confidence)

- `.planning/phases/10-match-screen-transition-split/10-CONTEXT.md` - Locked UX and transition decisions.
- `.planning/REQUIREMENTS.md` - UI-01 requirement contract.
- `.planning/STATE.md` - Current architectural constraints and prior phase decisions.
- `apps/web/index.html` - Current combined layout, transition CSS, and chat placement baseline.
- `apps/web/src/client.ts` - Existing lifecycle handling, reconnect messaging, and local override pathways.
- `apps/server/src/server.ts` - Authoritative lifecycle transitions and status broadcasts.
- `packages/rts-engine/socket-contract.ts` - Canonical `RoomStatus` and lifecycle payload types.
- `tests/integration/server/match-lifecycle.test.ts` - Reconnect and status convergence test patterns.
- `https://socket.io/docs/v4/delivery-guarantees/` (updated Jan 22, 2026) - Ordering and at-most-once delivery semantics.

### Secondary (MEDIUM confidence)

- None.

### Tertiary (LOW confidence)

- None.

## Metadata

**Confidence breakdown:**

- Standard stack: HIGH - all stack details and versions come from repository source and package metadata.
- Architecture: MEDIUM - authoritative routing model is clear, but final responsive layout/breakpoint details are still discretionary.
- Pitfalls: HIGH - each pitfall maps to concrete current code paths and known reconnect/lifecycle behavior.

**Research date:** 2026-03-02
**Valid until:** 2026-04-01
