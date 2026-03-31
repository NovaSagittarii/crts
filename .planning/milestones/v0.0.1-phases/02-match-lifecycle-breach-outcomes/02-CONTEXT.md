# Phase 2: Match Lifecycle & Breach Outcomes - Context

**Gathered:** 2026-02-27
**Status:** Ready for planning

<domain>
## Phase Boundary

This phase defines the authoritative match lifecycle and defeat outcomes for a running match: legal start/restart gating, lifecycle transitions (`lobby -> countdown -> active -> finished`), one canonical breach-based terminal outcome, and defeated/read-only UX. It does not add new terminal loss types, timeline visualizations, or advanced post-match controls.

</domain>

<decisions>
## Implementation Decisions

### Start Preconditions & Countdown Flow

- Start/restart is allowed only when exactly one player is assigned to each team, both are connected, and no reconnect-hold is pending.
- Countdown duration is 3 seconds.
- Countdown UI shows a prominent center overlay plus room status line.
- Host may cancel countdown any time before countdown reaches 0.
- Disconnect during countdown does not cancel countdown.

### Canonical Breach Outcome Rule

- A team is defeated when its core structure is destroyed.
- Core structures use HP-based restore behavior per `conway-rts/DESIGN.md`: on periodic restore checks, structure HP is consumed to restore expected local state; once HP reaches 0, the structure is dead/destroyed.
- Breach evaluation is authoritative and deterministic.
- If multiple teams breach on the same tick, resolve via deterministic tie-breaker from authoritative snapshot data.
- On breach resolution, transition immediately to `finished` and freeze gameplay actions.

### Defeat Lockout Experience

- Defeated users are hard-blocked from all gameplay mutation actions.
- Defeated users remain in read-only mode with live board/HUD/results visibility.
- Defeat UI is persistent and explicit: defeat banner/overlay, disabled gameplay controls, and reason text.
- Server rejects blocked actions with explicit reason `defeated`; client surfaces that reason.
- Defeated users see "spectating" wording to reinforce read-only mode.

### Finished-State UX and Restart Controls

- `finished` shows a centered results panel to all players.
- Results panel is minimizable.
- Minimized panel keeps key action buttons visible/pinned.
- Restart control is host-only; non-host sees disabled restart with waiting-for-host messaging.
- Users may return to lobby client-side at any time while in `finished`.
- If host restarts, replace results panel immediately with countdown overlay.
- If a user already returned to lobby and is still a valid room member/session, host restart pulls them back into restarted countdown flow.

### Restart Semantics

- Restart performs a full reset: map state, structures/HP, queues, economy, defeat flags, and prior results state/UI.
- Team assignments/slots persist by default across restart.
- Restart request is rejected with explicit reason when preconditions are not met; room remains in `finished`.

### Post-Match Statistics Contract

- Always include, per team: outcome, final core-structure HP/state, territory/cell count, and queued/applied/rejected build counts.
- Order teams winner first, then remaining teams by final rank.
- Show absolute values plus compact comparative indicators.
- Track timeline events internally in this phase, but do not display timeline UI yet.

### Multi-Team Future-Proofing

- Use multi-team-safe terminology now: `winner` + `defeated`/`eliminated` (avoid binary `loser` assumptions).
- Final results model/UX supports ranked standings (1st, 2nd, 3rd, ...) with per-team stats.
- Same-tick multi-team elimination rank conflicts resolve via deterministic snapshot tie-breaker.
- Player-facing copy and contracts in this phase avoid 1v1-only wording.

### In-Match Disconnect Behavior

- During `active`, simulation continues if a player disconnects (no pause).
- Connected player sees a small persistent disconnect status indicator.
- If disconnected player reclaims within window, restore immediately with authoritative resync and control recovery.
- If reconnect window expires, match remains `active`; breach remains the only terminal outcome in this phase.

### Chat and Read-Only Behavior by Lifecycle State

- Room chat remains available in `countdown`, `active`, `finished`, and defeated read-only states.
- Defeated/read-only users can still chat, minimize the results panel, and return to lobby.
- Defeated/read-only users keep full board and HUD visibility.

### OpenCode's Discretion

- Exact deterministic metric used for same-tick tie-break snapshots (must be documented and stable).
- Final visual styling and copy polish for overlays, badges, and panels, while preserving all locked semantics above.

</decisions>

<specifics>
## Specific Ideas

- Align core-structure HP/restore/destruction behavior with `conway-rts/DESIGN.md`.
- Restart should feel immediate and authoritative: host restart moves room directly into countdown, including valid members who had temporarily returned to lobby.
- Read-only defeated users should be explicitly labeled as "spectating" in UI language.

</specifics>

<deferred>
## Deferred Ideas

- Separate disconnect-timeout terminal loss reason (distinct from breach) — future phase.
- Timeline event display in post-match UI (events may be tracked now but not shown) — future phase.
- Results panel zoom controls — future phase.

</deferred>

---

_Phase: 02-match-lifecycle-breach-outcomes_
_Context gathered: 2026-02-27_
