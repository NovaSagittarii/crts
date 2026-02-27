# Web Client Guidelines

These rules apply to `apps/web/*`.

## Scope

- Browser UI composition, canvas interaction, and socket client orchestration.
- Presentation logic belongs here; deterministic simulation logic belongs in packages.

## Rules

- Treat the server as authoritative for game state.
- Do not implement simulation rules in the client; consume server `state` payloads.
- Keep socket event names/payloads aligned with `apps/server/AGENTS.md`.
- Validate and sanitize user-entered values before emitting events.
- Keep UI responsive for desktop and mobile viewport sizes.

## Event Usage

Client emits:

- `player:set-name`
- `room:list`
- `room:create`
- `room:join`
- `room:leave`
- `room:claim-slot`
- `room:set-ready`
- `room:start`
- `room:cancel-countdown`
- `chat:send`
- `build:queue`
- `cell:update`

Client listens for:

- `state`
- `room:list`
- `room:joined`
- `room:left`
- `room:membership`
- `room:slot-claimed`
- `room:countdown`
- `room:match-started`
- `room:match-finished`
- `room:error`
- `chat:message`
- `build:queued`
- `player:profile`

Finished/restart expectations:

- Treat `room:match-finished` as authoritative standings data (winner-first ranked outcomes).
- Keep defeated players in persistent read-only spectating mode; do not attempt client-side mutations.
- Use host-only `room:start` as the restart action from `finished`; non-host users should see waiting messaging.
