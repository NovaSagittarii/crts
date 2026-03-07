# Web Client Guidelines

These rules apply to `apps/web/*`.

## Scope

- Browser UI composition, canvas interaction, and socket client orchestration.
- Presentation logic belongs here; deterministic simulation logic belongs in packages.

## Rules

- Treat the server as the runtime coordinator for game-state synchronization.
- Do not implement simulation rules in the client; consume server `state` payloads.
- Keep socket event names/payloads aligned with `packages/rts-engine/socket-contract.ts`.
- Validate and sanitize user-entered values before emitting events.
- Treat gameplay mutation as queue-driven: use queue/event paths such as `build:queue` and `destroy:queue`; do not add direct board-mutation socket events.
- Keep UI responsive for desktop and mobile viewport sizes.

## Event Usage

- Canonical client emit/listen event names and payload shapes live in `packages/rts-engine/socket-contract.ts`.
- Keep web-layer guidance here focused on UX/state behavior, not duplicated wire-contract tables.

State sync expectations:

- Support both full `state` snapshots and partial updates delivered through `state:grid`, `state:structures`, and `state:hashes`.
- Use `state:request` for full or section-based resync requests; do not invent ad hoc resync events.
- Keep checkpoint/recovery UX aligned with `lockstep:checkpoint` and `lockstep:fallback` rather than client-local simulation shortcuts.

Economy/queue expectations:

- Keep in-match HUD economy readouts (`resources`, `income`, and breakdown details) sourced from `state.teams[].incomeBreakdown` and never from client-local rule simulation.
- Render pending queue timeline from `state.teams[].pendingBuilds` grouped by `executeTick` and ordered by `eventId`.
- Treat queue feedback as server-authoritative: reconcile optimistic UI against `build:queued`, `build:queue-rejected`, `build:scheduled`, `build:outcome`, `destroy:queued`, `destroy:queue-rejected`, `destroy:scheduled`, `destroy:outcome`, and `room:error`.
- Do not add preview-only gameplay socket events such as `build:preview`; derive affordance state from current room state plus authoritative queue outcomes.

Finished/restart expectations:

- Treat `room:match-finished` as canonical standings data for the room session (winner-first ranked outcomes).
- Keep defeated players in persistent read-only spectating mode; do not attempt client-side mutations.
- Use host-only `room:start` as the restart action from `finished`; non-host users should see waiting messaging.
