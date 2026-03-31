# Phase 10: Match Screen Transition Split - Context

**Gathered:** 2026-03-01
**Status:** Ready for planning

<domain>
## Phase Boundary

Split navigation into a dedicated lobby experience before gameplay and a dedicated in-game experience during matches, with screen transitions driven by authoritative match-state changes and reconnects landing on the correct screen for current state.

</domain>

<decisions>
## Implementation Decisions

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

</decisions>

<specifics>
## Specific Ideas

- Chat should sit off to the right in both lobby and in-game views.
- Shared status information should live along screen edges rather than centered modal-style overlays.
- Navigation split should reduce scrolling friction and keep primary controls immediately usable.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

_Phase: 10-match-screen-transition-split_
_Context gathered: 2026-03-01_
