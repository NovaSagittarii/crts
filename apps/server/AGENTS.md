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
- `room:cancel-countdown` `{}` (or no payload)
- `chat:send` `{ message }`
- `build:preview` `{ templateId, x, y }`
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
- `room:match-finished` `{ roomId, winner, ranked, comparator }` (winner-first standings; non-winners are `defeated`/`eliminated`)
- `room:error` `{ message, reason?, needed?, current?, deficit? }` (`needed/current/deficit` are included for `insufficient-resources` rejections)
- `chat:message` `{ roomId, senderSessionId, senderName, message, timestamp }`
- `build:preview` `{ roomId, teamId, templateId, x, y, affordable, needed, current, deficit, reason? }`
- `build:queued` `{ eventId, executeTick }`
- `build:outcome` `{ roomId, eventId, teamId, outcome, reason?, affordable?, needed?, current?, deficit?, executeTick, resolvedTick }`
- `player:profile` `{ playerId, name }`

State payload expectations:

- `state` remains room-scoped and carries authoritative `RoomStatePayload` team rows with `pendingBuilds[]` sorted by `executeTick` then `eventId`.
- Team rows include `incomeBreakdown` fields and pending queue metadata (`eventId`, `executeTick`, `templateId`, `templateName`, `x`, `y`) for reconnect-safe HUD/timeline rendering.

Lifecycle/status contract:

- Room status is authoritative and only transitions `lobby -> countdown -> active -> finished`.
- `room:start` is host-only and serves both initial start and restart from `finished`.
- `room:cancel-countdown` is host-only and only legal while status is `countdown`.
- Gameplay mutations are queue-only: accepted mutations must enter through `build:queue`, and `cell:update` is an explicit rejected bypass path.

Common `room:error.reason` values:

- `not-host`: host-only action attempted by non-host session.
- `invalid-transition`: lifecycle action rejected for current room status.
- `invalid-state`: gameplay mutation attempted outside `active`.
- `defeated`: defeated player attempted gameplay mutation.
- `not-ready`: lobby start attempted before both slotted players are ready.
- `queue-only-mutation-path`: direct `cell:update` gameplay bypass attempt was rejected.
- `out-of-bounds`: `build:queue` payload coordinates exceeded room bounds.
- `outside-territory`: `build:queue` payload targeted cells beyond team territory.
- `invalid-coordinates`: `build:queue` payload included non-integer coordinates.
- `invalid-delay`: `build:queue` delay value was not an integer.
- `unknown-template`: `build:queue` referenced a template that is not available.
- `insufficient-resources`: queue request was unaffordable; payload includes exact `needed/current/deficit` values.

## Rules

- Validate payloads at socket boundaries before passing into engine functions.
- Keep server authority model: clients request changes; server decides and broadcasts.
- Use `process.cwd()`-anchored paths for runtime static assets in this repo layout.
- Keep room broadcasts scoped via room channels; avoid global `state` emissions.
- Do not import from `apps/web/*`.
