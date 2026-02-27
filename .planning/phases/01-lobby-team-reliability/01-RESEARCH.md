# Phase 1: Lobby & Team Reliability - Research

**Researched:** 2026-02-27
**Domain:** Socket.IO room/lobby reliability, deterministic team assignment, reconnect continuity
**Confidence:** MEDIUM

<user_constraints>

## User Constraints (from CONTEXT.md)

### Locked Decisions

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

### Deferred Ideas (OUT OF SCOPE)

- Auto-loss/win/draw semantics tied to all-player disconnect during/after match are match-lifecycle outcomes and should be finalized in **Phase 2: Match Lifecycle & Breach Outcomes**.
  </user_constraints>

<phase_requirements>

## Phase Requirements

| ID       | Description                                                                                       | Research Support                                                                                                                                                   |
| -------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| LOBBY-01 | User can list, create, join, and leave rooms with deterministic membership updates.               | Use server-authoritative room aggregate + monotonically increasing membership revision + room-scoped broadcasts (`io.to(room).emit`) and explicit join/leave acks. |
| LOBBY-02 | User can join a team and receive deterministic base assignment for that team.                     | Add explicit player-slot/team-slot model in engine layer; reject full-team joins with typed reasons; assign base from deterministic spawn function.                |
| LOBBY-03 | Team spawn locations are equally spaced on the torus map to ensure fair starts and avoid overlap. | Replace current candidate-based spawn picker with circle-on-torus spawn generation using equal angle steps, modulo wrapping, and overlap validation.               |
| LOBBY-04 | Reconnecting user can rejoin their room and receive authoritative state resync.                   | Use stable session ID via `socket.handshake.auth`, 30s slot hold, reconnect reclaim priority, and authoritative room snapshot resync after connect/recover.        |

</phase_requirements>

## Summary

Phase 1 should be planned as a reliability refactor of lobby identity/state ownership rather than a UI-only change. The current code already has room create/join/leave primitives and room-scoped state emission, but it uses `socket.id` as identity and immediately removes room membership on disconnect. That behavior cannot satisfy the locked reconnect/slot-hold decisions and will race under reconnect/spectator contention.

Use Socket.IO 4.8.3 capabilities directly: room channels for deterministic fanout, `auth` payload for stable session identity, and optional `connectionStateRecovery` for missed packet replay when reconnection succeeds. Official docs are explicit that Socket.IO still defaults to at-most-once delivery and does not buffer missed server events by default, so planner tasks should require an authoritative full-room resync path on (re)connect even when recovery is enabled.

For spawn fairness, the current `pickSpawnPosition()` in `packages/rts-engine/src/rts.ts` is fixed-candidate and can fallback to `{0,0}`, which can overlap at scale. Plan a deterministic torus circle-placement function with equal angular spacing and explicit overlap checks so LOBBY-03 is verifiable.

**Primary recommendation:** Implement a server-authoritative `LobbyRoomState` with stable player session IDs, explicit slot states (`active`/`held`/`spectator`), deterministic spawn generation, and reconnect-first reclaim logic before adding UI polish.

## Standard Stack

### Core

| Library            | Version | Purpose                                                            | Why Standard                                                                      |
| ------------------ | ------- | ------------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| `socket.io`        | 4.8.3   | Server event transport, room fanout, reconnect recovery hooks      | Native room semantics + documented recovery/ack patterns for realtime multiplayer |
| `socket.io-client` | 4.8.3   | Browser socket client, reconnect behavior, auth payload transport  | Matches server version; first-class support for reconnection and handshake auth   |
| `express`          | 4.22.1  | HTTP/static hosting for web client and Socket.IO server attachment | Already integrated and stable in current runtime                                  |
| `typescript`       | 5.9.3   | Typed event/payload contracts and deterministic domain APIs        | Existing strict-mode baseline in repo                                             |

### Supporting

| Library                   | Version            | Purpose                                                        | When to Use                                                      |
| ------------------------- | ------------------ | -------------------------------------------------------------- | ---------------------------------------------------------------- |
| `vitest`                  | 1.6.1              | Unit + integration verification for lobby/reconnect invariants | For room membership, slot hold timeout, and reconnect race tests |
| `Web Crypto randomUUID()` | Baseline (browser) | Generate `guest-{uuid}` fallback names                         | On first client session bootstrap when name is blank             |

### Alternatives Considered

| Instead of                          | Could Use                              | Tradeoff                                                                                                   |
| ----------------------------------- | -------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Socket.IO connection-state recovery | Full custom replay log + offsets in DB | Better long-term durability, but much higher scope than Phase 1 and unnecessary for in-memory prototype    |
| In-memory session map only          | Cookie-backed session middleware       | Better cross-tab persistence/security, but adds middleware complexity not required by current requirements |

**Installation:**

```bash
# No new phase-specific packages are required.
npm install
```

## Architecture Patterns

### Recommended Project Structure

```
apps/server/src/
├── server.ts                # Socket lifecycle + room routing + timers
└── lobby-session.ts         # Reconnect hold window + reclaim orchestration

packages/rts-engine/src/
├── rts.ts                   # Keep existing match/build logic
├── lobby.ts                 # Room/slot/team authority model for pre-match
└── spawn.ts                 # Deterministic torus spawn generation

tests/integration/server/
└── lobby-reliability.test.ts # Join/leave/reconnect/spectator race contract tests
```

### Pattern 1: Stable Session Identity over Ephemeral Socket IDs

**What:** Bind a durable `sessionId` (from client local storage/auth payload) to server lobby state; bind transient `socket.id` only as current transport handle.
**When to use:** All room/team membership, host ownership, and reconnect reclaim logic.
**Example:**

```typescript
// Source: https://socket.io/docs/v4/client-options/#auth
// Source: https://socket.io/docs/v4/server-socket-instance/#sockethandshake
const socket = io({ auth: { sessionId } });

io.on('connection', (socket) => {
  const sessionId = String(socket.handshake.auth.sessionId ?? '');
  // map sessionId -> player slot, socket.id -> active connection
});
```

### Pattern 2: Authoritative Reconnect with Hold Window

**What:** On disconnect, mark slot as held until `now + 30s` and keep team assignment reserved; on reconnect, reclaim slot before spectator claim.
**When to use:** Any disconnect reason eligible for auto-reconnect (`transport close`, `ping timeout`).
**Example:**

```typescript
// Source: https://socket.io/docs/v4/server-socket-instance/#disconnect
// Source: https://socket.io/docs/v4/rooms/#disconnection
socket.on('disconnect', () => {
  holdSlot(playerSlotId, Date.now() + 30_000);
  // do not delete team/player domain state immediately
});
```

### Pattern 3: Deterministic Circle Spawns on Torus

**What:** Compute team spawn centers via `angle = theta0 + 2πk/n`, project to map center/radius, wrap with modulo, reject overlap.
**When to use:** Initial match start and rematch reseeding.
**Example:**

```typescript
// Source: phase requirement LOBBY-03 + deterministic server authority policy
const angle = theta0 + (2 * Math.PI * k) / teamCount;
const x = mod(Math.round(cx + radius * Math.cos(angle)), width);
const y = mod(Math.round(cy + radius * Math.sin(angle)), height);
```

### Anti-Patterns to Avoid

- **Using `socket.id` as player identity:** It is regenerated on reconnect; use stable session ID via `auth` instead.
- **Immediate player removal on disconnect:** Violates 30-second slot-hold requirement and causes spectator/rejoin races.
- **Spawn-by-first-free-candidate:** Not evenly spaced and can overlap when candidate list is exhausted.
- **Client-authoritative team claims:** Team/slot assignment must stay server-authoritative to keep deterministic room state.

## Don't Hand-Roll

| Problem                                 | Don't Build                            | Use Instead                                              | Why                                                                                     |
| --------------------------------------- | -------------------------------------- | -------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Room fanout and membership broadcasting | Custom pub/sub per room                | Socket.IO rooms (`socket.join`, `io.to(room).emit`)      | Battle-tested semantics and room lifecycle events                                       |
| Packet replay for short disconnects     | Ad hoc in-memory packet queue protocol | `connectionStateRecovery` + authoritative full-room sync | Official support for temporary disconnect recovery; still keep explicit resync fallback |
| Request-response event reliability      | Manual retry loops per event           | Socket.IO acknowledgements + `timeout`/`emitWithAck`     | Clear success/failure handling and bounded retry behavior                               |
| UUID fallback names                     | Homegrown random string generator      | `crypto.randomUUID()` / `self.crypto.randomUUID()`       | Cryptographically secure, standardized UUIDv4 format                                    |

**Key insight:** Use Socket.IO transport/recovery primitives for network reliability, and spend custom logic budget only on game-specific lobby invariants (slot ownership, host transfer, spawn fairness).

## Common Pitfalls

### Pitfall 1: Identity Drift on Reconnect

**What goes wrong:** Reconnecting players are treated as new users and lose team/host slot.
**Why it happens:** `socket.id` is ephemeral and changes on reconnect.
**How to avoid:** Persist `sessionId` client-side and send via `auth`; map lobby identity to session, not socket.
**Warning signs:** Duplicate players with same name/team tag after brief network flap.

### Pitfall 2: False Assumption of Guaranteed Delivery

**What goes wrong:** Clients miss membership events and diverge from authoritative state.
**Why it happens:** Socket.IO defaults to at-most-once arrival and no server-side buffer for disconnected clients.
**How to avoid:** Emit full authoritative room snapshot on join/rejoin; use recovery as optimization, not sole correctness path.
**Warning signs:** User list differs across clients after reconnect.

### Pitfall 3: Disconnect Auto-Leave Conflicts with Slot Hold

**What goes wrong:** Held slots vanish immediately after disconnect.
**Why it happens:** Socket.IO removes sockets from rooms automatically when disconnected.
**How to avoid:** Keep slot/team hold in your own domain state; treat room membership channels and player-slot state separately.
**Warning signs:** Rejoin within 30 seconds fails because slot no longer exists.

### Pitfall 4: Spawn Fairness Regressions

**What goes wrong:** Teams spawn unevenly or overlap.
**Why it happens:** Candidate-based placement does not enforce equal angular spacing or minimum wrapped distance.
**How to avoid:** Precompute all team spawns from one deterministic formula and validate non-overlap before match start.
**Warning signs:** Same or adjacent base coordinates for different teams in logs/tests.

## Code Examples

Verified patterns from official sources:

### Enable Connection State Recovery (Server)

```typescript
// Source: https://socket.io/docs/v4/connection-state-recovery
const io = new Server(httpServer, {
  connectionStateRecovery: {
    maxDisconnectionDuration: 30_000,
    skipMiddlewares: true,
  },
});
```

### Send Stable Session Credentials from Client

```typescript
// Source: https://socket.io/docs/v4/client-options/#auth
const socket = io({
  auth: { sessionId },
});
```

### Room-Scoped Authoritative Broadcast

```typescript
// Source: https://socket.io/docs/v4/rooms/
socket.join(`room:${roomId}`);
io.to(`room:${roomId}`).emit('room:state', stateSnapshot);
```

### Ack + Timeout for Membership Mutations

```typescript
// Source: https://socket.io/docs/v4/emitting-events/#with-timeout
socket.timeout(2000).emit('room:join', { roomId }, (err, response) => {
  if (err) {
    // no acknowledgement in time
  }
});
```

## State of the Art

| Old Approach                            | Current Approach                                                                 | When Changed                                   | Impact                                                                 |
| --------------------------------------- | -------------------------------------------------------------------------------- | ---------------------------------------------- | ---------------------------------------------------------------------- |
| Treat `socket.id` as player identity    | Use stable session ID via `auth`; treat socket ID as transport handle            | Documented in Socket.IO 4.x API (current docs) | Rejoin logic survives transient reconnects                             |
| Ignore temporary disconnect packet loss | Enable `connectionStateRecovery` (v4.6+) and still resync authoritative snapshot | v4.6.0 (Feb 2023)                              | Fewer missed events during short outages without giving up correctness |
| Fixed candidate spawn picking           | Deterministic torus circle placement with overlap checks                         | Needed for LOBBY-03 fairness guarantee         | Predictable, testable fair starts                                      |

**Deprecated/outdated:**

- Using raw socket connection lifecycle as lobby truth: insufficient for slot-hold and reconnect race guarantees.

## Open Questions

1. **Room-code format and collision policy**
   - What we know: Users must support list browsing and room-code join.
   - What's unclear: Required code length/readability and uniqueness strategy.
   - Recommendation: Keep current room ID as MVP room code in Phase 1; postpone vanity code format if not required by acceptance tests.

2. **Reconnect behavior across full server restart**
   - What we know: Current architecture is in-memory only.
   - What's unclear: Whether restart continuity is required for this phase.
   - Recommendation: Treat process restart continuity as out of scope for Phase 1; document clearly in UX copy/toasts.

3. **Host transfer tie-breaker rule**
   - What we know: Host transfers when host leaves pre-match; newest session wins for duplicate reconnect sessions.
   - What's unclear: Deterministic tie-break among multiple eligible non-host players.
   - Recommendation: Use stable player slot order (join order) as deterministic host transfer rule and test it explicitly.

## Sources

### Primary (HIGH confidence)

- https://socket.io/docs/v4/rooms/ - Server-only room model, join/leave semantics, auto-leave on disconnect
- https://socket.io/docs/v4/connection-state-recovery - Recovery config, limits, and `socket.recovered` behavior
- https://socket.io/docs/v4/delivery-guarantees - Ordering guarantees vs at-most-once arrival defaults
- https://socket.io/docs/v4/client-options/ - `auth`, retries/ackTimeout, reconnection options
- https://socket.io/docs/v4/server-socket-instance/ - `socket.id` ephemerality, `handshake.auth`, disconnect reasons
- https://socket.io/docs/v4/emitting-events/ - Acknowledgements and timeout patterns
- https://socket.io/docs/v4/changelog/4.6.0 - Date/version provenance for connection-state recovery and promise ack APIs
- `apps/server/src/server.ts` - Current lobby/session lifecycle and socket event contract
- `packages/rts-engine/src/rts.ts` - Current team/base spawn assignment implementation (`pickSpawnPosition`)
- `tests/integration/server/server.test.ts` - Existing integration coverage baseline

### Secondary (MEDIUM confidence)

- https://developer.mozilla.org/en-US/docs/Web/API/Crypto/randomUUID - Browser UUIDv4 fallback generation for `guest-{uuid}`

### Tertiary (LOW confidence)

- None.

## Metadata

**Confidence breakdown:**

- Standard stack: HIGH - Versions verified locally (`npm ls`) and aligned with current repo/runtime.
- Architecture: MEDIUM - Core patterns are strongly supported by official Socket.IO docs, but exact slot/host model is project-specific design work.
- Pitfalls: HIGH - Directly evidenced by current code paths and official transport/disconnect semantics.

**Research date:** 2026-02-27
**Valid until:** 2026-03-29 (30 days)
