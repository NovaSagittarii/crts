# Server Runtime Guidelines

These rules apply to `apps/server/*`.

## Scope

- Keep HTTP/Socket.IO wiring, connection lifecycle, and room routing in this layer.
- Keep simulation/state rules in `packages/*` and call package APIs from here.

## Event Contract

- Canonical event names and payload shapes live in `packages/rts-engine/socket-contract.ts`.
- Keep this file focused on runtime lifecycle/validation constraints and rejection taxonomy.
- Do not re-declare socket event payload interfaces in `apps/server/*`.

State payload expectations:

- `state` remains room-scoped and carries deterministic `RoomStatePayload` team rows with `pendingBuilds[]` sorted by `executeTick` then `eventId`.
- Incremental resync uses `state:grid`, `state:structures`, and `state:hashes`; `state:request` may ask for full or section-based refreshes.
- Team rows include `incomeBreakdown` fields and pending queue metadata (`eventId`, `executeTick`, `templateId`, `templateName`, `x`, `y`) for reconnect-safe HUD/timeline rendering.
- Lockstep recovery signals flow through `lockstep:checkpoint` and `lockstep:fallback` rather than app-specific resync events.

Lifecycle/status contract:

- Room status is coordinator-driven and only transitions `lobby -> countdown -> active -> finished`.
- `room:start` is host-only and serves both initial start and restart from `finished`.
- `room:cancel-countdown` is host-only and only legal while status is `countdown`.
- Gameplay mutations are queue-only: accepted mutations must enter through queue/event paths such as `build:queue` and `destroy:queue`.
- Accepted queue mutations fan out through `build:queued`, `build:outcome`, and destroy counterparts; keep those server emissions aligned with the shared contract.

Illustrative (not exhaustive) `room:error.reason` examples:

- `not-host`: host-only action attempted by non-host session.
- `invalid-transition`: lifecycle action rejected for current room status.
- `invalid-state`: gameplay mutation attempted outside `active`.
- `defeated`: defeated player attempted gameplay mutation.
- `not-ready`: lobby start attempted before all required seats/slots were filled and ready.
- `template-exceeds-map-size`: `build:queue` referenced a template footprint that cannot fit inside the map.
- `outside-territory`: `build:queue` payload targeted cells beyond the team's union build zone.
- `invalid-coordinates`: `build:queue` payload included non-integer coordinates.
- `invalid-delay`: `build:queue` delay value was not an integer.
- `unknown-template`: `build:queue` referenced a template that is not available.
- `insufficient-resources`: queue request was unaffordable; payload includes exact `needed/current/deficit` values.
- `not-in-room`: request requires membership in a room.
- `room-not-found`: join request targeted an unknown room id/code.
- `invalid-slot`: slot claim payload or slot id was invalid.
- `slot-held`: slot is currently held for a disconnected player during reconnect grace.
- `invalid-ready`: ready-toggle payload was malformed.
- `countdown-locked`: ready/slot mutation attempted while countdown is running.
- `match-started`: lobby mutation attempted after match became active.
- `invalid-chat`: chat payload was empty or invalid.
- `invalid-build`: build payload was malformed.
- `wrong-owner` / `invalid-target` / `invalid-lifecycle-state`: destroy/build queue requests failed ownership, target, or lifecycle validation.
- `team-defeated` / `team-unavailable` / `build-rejected`: queue request failed deterministic placement/team checks.
- `session-replaced`: session auth token was replaced by a newer socket connection.

## Rules

- Validate payloads at socket boundaries before passing into engine functions.
- Keep a coordinator model: clients request changes; the runtime validates ordering and broadcasts shared outcomes.
- Resolve runtime static asset paths from module location (or explicit config), not `process.cwd()`.
- Keep room broadcasts scoped via room channels; avoid global `state` emissions.
- Do not import from `apps/web/*`.
