# Web Client Guidelines

These rules apply to `apps/web/*`.

## Scope

- Browser UI composition, canvas interaction, and socket client orchestration.
- Presentation logic belongs here; deterministic simulation logic belongs in packages.

## Rules

- Treat the server as authoritative for game state.
- Do not implement simulation rules in the client; consume server `state` payloads.
- Keep socket event names/payloads aligned with `packages/rts-engine/socket-contract.ts`.
- Validate and sanitize user-entered values before emitting events.
- Treat gameplay mutation as queue-driven: `build:queue` is the accepted path, while `cell:update` is legacy/debug and should expect `queue-only-mutation-path` rejection.
- Keep UI responsive for desktop and mobile viewport sizes.

## Event Usage

- Canonical client emit/listen event names and payload shapes live in `packages/rts-engine/socket-contract.ts`.
- Keep web-layer guidance here focused on UX/state behavior, not duplicated wire-contract tables.

Phase 4 economy/queue contract expectations:

- Drive queue affordability UI from authoritative `build:preview` payloads (`affordable`, `needed`, `current`, `deficit`, `reason`) before enabling queue actions.
- Keep in-match HUD economy readouts (`resources`, `income`, and breakdown details) sourced from `state.teams[].incomeBreakdown` and never from client-local rule simulation.
- Render pending queue timeline from `state.teams[].pendingBuilds` grouped by `executeTick` and ordered by `eventId`.
- Surface queue rejection feedback from `room:error` deficit metadata and reconcile terminal status from `build:outcome` rather than assuming queued events always apply.

Finished/restart expectations:

- Treat `room:match-finished` as authoritative standings data (winner-first ranked outcomes).
- Keep defeated players in persistent read-only spectating mode; do not attempt client-side mutations.
- Use host-only `room:start` as the restart action from `finished`; non-host users should see waiting messaging.
