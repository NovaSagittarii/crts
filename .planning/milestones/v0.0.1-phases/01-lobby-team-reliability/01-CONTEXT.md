# Phase 1: Lobby & Team Reliability - Context

**Gathered:** 2026-02-27
**Status:** Ready for planning

<domain>
## Phase Boundary

Deliver a reliable pre-match multiplayer flow where players can discover/join rooms, claim teams, see fair spawn setup, and reconnect without state drift.
This phase clarifies lobby/team/reconnect behavior only; deeper match resolution and expanded gameplay remain outside this boundary.

</domain>

<decisions>
## Implementation Decisions

### Reconnect policy

- Reserve a disconnected player's slot for **30 seconds**.
- Keep the reserved slot locked during the hold window.
- Show disconnect state with a quiet icon in lobby/match UI.
- If timeout expires, remove the player from the room.

### Room access and host control

- Room entry supports both room list browsing and room-code join.
- Target capacity is **2 players + spectators**.
- Host can start only when both players are ready.
- If host leaves before match start, host role transfers to another player.

### Team assignment rules

- One player maps to one in-game team by default.
- Joining a full team is rejected with explicit reason.
- No team switching after team choice.
- Readiness is explicit via manual ready toggle.

### Spawn fairness rules

- Team spawns are placed with even spacing on the torus (circle distribution).
- Spawn orientation is randomized at match start.
- Rematches re-randomize spawn spots.
- Lobby shows all spawn markers before match start.

### Spectator behavior

- Spectators can view full board and match HUD during active play.
- Spectators can use full match chat.
- If a pre-match player slot opens, spectators claim it via explicit join-by-slot action.
- No automatic spectator promotion when a held slot times out.

### Identity and readiness display

- Name is set on join; empty name falls back to `guest-{uuid}`.
- Duplicate visible names are allowed and disambiguated by team tag.
- Team identity uses color plus explicit team label.
- Player rows show ready badge and icon.

### Start guardrails

- Start countdown is 3 seconds once readiness preconditions are met.
- If someone toggles Not Ready during countdown, countdown continues (change ignored).
- No host force-start override while required players are Not Ready.
- If a player disconnects during countdown, match start can continue.

### Rejoin race handling

- During hold window, reconnecting player has priority over spectator slot-claim races.
- Returning after timeout joins as spectator if old slot is occupied.
- If reconnecting from multiple sessions, newest session wins control.
- Failed reclaim/race outcomes are explained via inline status plus toast.

### OpenCode's Discretion

- Exact iconography/art style for status, readiness, and spawn markers.
- Exact copy tone for toasts and inline status messages.
- Minor lobby layout spacing/details as long as decisions above remain intact.

</decisions>

<specifics>
## Specific Ideas

- "Players should be equally spaced on the map (a torus) as a circle" for fairness.
- Player model clarified as: one client controls one team entity (with its own resources/state).
- Reconnect race outcomes should be explicit in UI, not silent state jumps.

</specifics>

<deferred>
## Deferred Ideas

- Auto-loss/win/draw semantics tied to all-player disconnect during/after match are match-lifecycle outcomes and should be finalized in **Phase 2: Match Lifecycle & Breach Outcomes**.

</deferred>

---

_Phase: 01-lobby-team-reliability_
_Context gathered: 2026-02-27_
