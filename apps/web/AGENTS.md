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
- `build:queue`
- `cell:update`

Client listens for:

- `state`
- `room:list`
- `room:joined`
- `room:left`
- `room:error`
- `build:queued`
- `player:profile`
