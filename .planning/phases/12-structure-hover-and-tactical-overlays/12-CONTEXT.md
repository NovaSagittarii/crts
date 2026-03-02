# Phase 12: Structure Hover and Tactical Overlays - Context

**Gathered:** 2026-03-02
**Status:** Ready for planning

<domain>
## Phase Boundary

Players can inspect structures and use nearby overlays for economy, build, and team decision-making. Hover provides quick inspection; overlays give tactical information. Creating new game mechanics or new overlay types belong in other phases.

</domain>

<decisions>
## Implementation Decisions

### Hover Interaction Model

- Hover shows ephemeral preview; click/tap pins the structure for stable interaction
- Actions appear only when structure is pinned/selected (not on hover)
- Brief grace delay (~300ms) when cursor leaves structure, unless pinned — prevents flicker when moving between nearby cells
- Single active structure at a time (no compare mode, reduces UI noise)

### Overlay Layout Around Grid

- Default layout: fixed side rail next to grid with stacked sections (Economy, Build, Team)
- Rail must support flexible composition — new overlay sections may be added or rearranged in future
- Desktop behavior: collapsible sections in a persistent rail (always reachable, not crowding)
- Small screens: tabbed drawer for Economy/Build/Team (best space efficiency with quick switching)
- Visual spacing: moderate gap with clear border/containment (readable, not cluttered)

### Information Density & Update Behavior

- Pinned structure panel shows tactical summary by default: owner, HP/integrity, current state, available actions
- Overlays show key metrics first with expandable details (keeps gameplay flowing)
- Live updates are instant with subtle delta highlight for ~1 second (readable changes, not distracting)
- Sync lag: show small "syncing" hint only when data is delayed (confidence without constant noise)

### Action Feedback Style

- Pending actions show immediate optimistic UI + small spinner/pending badge (feels responsive)
- Authoritative results appear near the interaction source (by pinned panel or overlay)
- Rejected actions show inline message explaining why + quick dismiss (educational, not blocking)
- Error messages use player-friendly phrasing with context (e.g., "Not enough resources" vs "INSUFFICIENT_ECONOMY")

### OpenCode's Discretion

- Exact grace delay duration (target ~300ms, adjust if testing shows better value)
- Delta highlight visual treatment (color, animation style)
- "Syncing" indicator visual design
- Exact pin/unpin gesture handling on touch devices

</decisions>

<specifics>
## Specific Ideas

- Grace delay prevents frustrating flicker when user is scanning multiple nearby structures
- Player-friendly errors help new players learn without needing to understand internal error codes
- Flexible rail composition ensures future overlay additions don't require layout rewrites

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

_Phase: 12-structure-hover-and-tactical-overlays_
_Context gathered: 2026-03-02_
