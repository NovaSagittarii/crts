# Server Runtime Guidelines

These rules apply to `apps/server/*`.

## Scope

- Keep HTTP/Socket.IO wiring, connection lifecycle, and room routing in this layer.
- Keep simulation/state rules in `packages/*` and call package APIs from here.

## Event Contract

Server receives:

- `player:set-name` `{ name }`
- `room:list` `{}` (or no payload)
- `room:create` `{ name?, width?, height? }`
- `room:join` `{ roomId?, roomCode?, slotId? }`
- `room:leave` `{}`
- `room:claim-slot` `{ slotId }`
- `room:set-ready` `{ ready }`
- `room:start` `{ force? }`
- `chat:send` `{ message }`
- `build:queue` `{ templateId, x, y, delayTicks? }`
- `cell:update` `{ x, y, alive }`

Server emits:

- `state` room-scoped `RoomStatePayload`
- `room:list` `RoomListEntry[]` with room code/status/spectator counts
- `room:joined` `{ roomId, roomCode, roomName, playerId, playerName, teamId|null, templates, state }`
- `room:left` `{ roomId }`
- `room:membership` `{ revision, status, hostSessionId, slots, participants, ... }`
- `room:slot-claimed` `{ roomId, slotId, teamId }`
- `room:countdown` `{ roomId, secondsRemaining }`
- `room:match-started` `{ roomId }`
- `room:error` `{ message, reason? }`
- `chat:message` `{ roomId, senderSessionId, senderName, message, timestamp }`
- `build:queued` `{ eventId, executeTick }`
- `player:profile` `{ playerId, name }`

## Rules

- Validate payloads at socket boundaries before passing into engine functions.
- Keep server authority model: clients request changes; server decides and broadcasts.
- Use `process.cwd()`-anchored paths for runtime static assets in this repo layout.
- Keep room broadcasts scoped via room channels; avoid global `state` emissions.
- Do not import from `apps/web/*`.
