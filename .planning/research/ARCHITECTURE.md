# Architecture Research

**Domain:** Server-authoritative Conway RTS browser prototype (lobby/team-first)
**Researched:** 2026-02-27
**Confidence:** MEDIUM

## Standard Architecture

### System Overview

```text
┌──────────────────────────────────── Browser (apps/web) ────────────────────────────────────┐
│  Lobby UI  │  Team Setup UI  │  Match HUD  │  Canvas Renderer (requestAnimationFrame)      │
│                                                                                              │
│                Intent Builder (ghost plans, room actions, ready/start)                      │
│                                      │                                                       │
│                                      ▼                                                       │
│                              Socket Client Adapter                                           │
└──────────────────────────────────────┬───────────────────────────────────────────────────────┘
                                       │ room-scoped events + acks
┌──────────────────────────────────────┴───────────────────────────────────────────────────────┐
│                               Server Runtime (apps/server)                                   │
│  Socket Gateway -> Runtime Validation -> Lobby/Team Service -> Match Lifecycle Coordinator  │
│         │                                   │                           │                    │
│         │                                   ▼                           ▼                    │
│         │                             Room Directory              Tick Scheduler             │
│         │                                                              │                     │
│         └---------------------- Snapshot/Delta Broadcaster <-----------┘                     │
└──────────────────────────────────────┬───────────────────────────────────────────────────────┘
                                       │ pure deterministic function calls
┌──────────────────────────────────────┴───────────────────────────────────────────────────────┐
│                                 Domain Packages (packages/*)                                 │
│  protocol contracts | lobby state machine | rts command queue | conway-core step/encoding   │
└───────────────────────────────────────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

| Component                     | Responsibility                                                    | Typical Implementation                                   |
| ----------------------------- | ----------------------------------------------------------------- | -------------------------------------------------------- |
| `Socket Gateway`              | Own event names, per-event auth checks, ack/reject mapping        | `apps/server/src/socket/*` handlers calling package APIs |
| `Room Directory`              | Create/list/join/leave rooms and membership                       | In-memory map first; deterministic IDs and room channels |
| `Lobby/Team Service`          | Team assignment, host controls, ready checks, start preconditions | Pure transitions in `packages/rts-engine/src/lobby/*`    |
| `Match Lifecycle Coordinator` | Enforce phases (`lobby -> countdown -> active -> finished`)       | Explicit finite-state reducer with guards                |
| `Tick Scheduler`              | Produce fixed simulation ticks and call engine in order           | Accumulator loop with max-steps clamp                    |
| `RTS Command Engine`          | Validate and execute queued commands at `executeTick`             | `queue*` + `tick*` pure functions                        |
| `Conway Core`                 | Deterministic grid stepping and bit-encoding                      | `packages/conway-core/src/grid.ts`                       |
| `State Broadcaster`           | Emit room state updates with version metadata                     | `state:delta` + periodic `state:snapshot`                |
| `Client State Store`          | Keep server-confirmed state and local transient UI overlays       | Store module in `apps/web/src/state/*`                   |
| `Canvas Renderer`             | Render from store at display cadence, not network cadence         | `requestAnimationFrame` rendering loop                   |

## Recommended Project Structure

```text
apps/
├── server/src/
│   ├── socket/                # Event handlers + payload validation + ack wiring
│   ├── rooms/                 # Room directory and membership orchestration
│   ├── lifecycle/             # Lobby/countdown/active/finished orchestration
│   ├── tick/                  # Fixed-step scheduler and tick orchestration
│   └── sync/                  # Snapshot/delta emission + resync handlers
└── web/src/
    ├── socket/                # Typed socket adapter
    ├── state/                 # Authoritative state store + selectors
    ├── scenes/lobby/          # Room/team/ready UI
    ├── scenes/match/          # Match HUD + command UI
    └── render/                # Canvas rendering and ghost overlay

packages/
├── conway-core/src/           # Pure cellular automata logic and encoding
├── rts-engine/src/lobby/      # Lobby/team transitions (deterministic)
├── rts-engine/src/match/      # Tick reducer, queue processing, win conditions
└── protocol/src/              # Shared event contracts + DTO schemas
```

### Structure Rationale

- **`packages/protocol`:** Single source of truth for event contracts to prevent server/client/test drift.
- **`rts-engine` split by `lobby` and `match`:** Keeps pre-game and in-game rules separate, enabling focused tests and safer iteration.
- **Server `tick/` and `sync/` separation:** Decouples simulation timing from transport concerns, reducing accidental nondeterminism.
- **Web `state/` + `render/` split:** Prevents network event storms from directly triggering heavy paint work.

## Architectural Patterns

### Pattern 1: Authoritative Intent Pipeline

**What:** Clients send intents, server validates and schedules deterministic execution, server broadcasts results.
**When to use:** All gameplay-affecting actions (`build`, `commit-ghosts`, `ready/start`, `team-change`).
**Trade-offs:** Strong consistency and anti-cheat posture, but more server-side implementation effort.

**Example:**

```typescript
// server side shape (conceptual)
interface BuildIntent {
  commandId: string;
  roomId: string;
  teamId: number;
  templateId: string;
  x: number;
  y: number;
  executeTick: number;
}

function handleBuildIntent(intent: BuildIntent): {
  accepted: boolean;
  reason?: string;
} {
  const validated = validateBuildIntent(intent);
  if (!validated.ok) return { accepted: false, reason: validated.reason };
  enqueueBuildCommand(validated.value);
  return { accepted: true };
}
```

### Pattern 2: Explicit Match Lifecycle State Machine

**What:** Lifecycle is a reducer with explicit phase transitions and guards, not ad-hoc booleans.
**When to use:** Lobby readiness, countdown start, match end, rematch/reset.
**Trade-offs:** Slightly more ceremony upfront, much lower long-term bug rate.

**Example:**

```typescript
type Phase = 'lobby' | 'countdown' | 'active' | 'finished';

function transition(
  phase: Phase,
  event: 'all-ready' | 'countdown-done' | 'breach',
): Phase {
  if (phase === 'lobby' && event === 'all-ready') return 'countdown';
  if (phase === 'countdown' && event === 'countdown-done') return 'active';
  if (phase === 'active' && event === 'breach') return 'finished';
  return phase;
}
```

### Pattern 3: Snapshot + Delta Synchronization

**What:** Frequent deltas for responsiveness plus periodic snapshots for recovery and anti-drift.
**When to use:** Grid/state updates over variable mobile/desktop networks.
**Trade-offs:** More protocol complexity, major reduction in bandwidth spikes and desync pain.

**Example:**

```typescript
interface StateDelta {
  fromTick: number;
  toTick: number;
  changedCells: Array<{ x: number; y: number; alive: 0 | 1 }>;
}

if (delta.fromTick !== client.lastAppliedTick) {
  socket.emit('state:resync', {
    roomId,
    lastAppliedTick: client.lastAppliedTick,
  });
}
```

## Data Flow

### Authority Model

- **Server authoritative:** Room state, team assignments, lifecycle phase, resource accounting, and Conway ticks are owned by the server only.
- **Client intent-only:** Browser sends commands and lobby actions, never authoritative mutations.
- **Client local-only overlays:** Ghost planning preview and optimistic UI messaging can be local, but must reconcile to server acks/state.

### Request Flow

```text
[User action in lobby/match UI]
    ↓
[Client intent builder]
    ↓ emits intent with commandId
[Socket gateway]
    ↓ validates payload and phase permissions
[Lobby service or match command queue]
    ↓ accepted intents become scheduled events
[Tick scheduler executes deterministic reducer]
    ↓
[State broadcaster emits delta/snapshot with tick metadata]
    ↓
[Client store applies in order, renderer paints on rAF]
```

### State Management

```text
Server: RoomAggregate (canonical)
  ├── LobbyState (members, teams, ready, host)
  ├── MatchState (grid, resources, queue, tick, victory)
  └── PhaseState (lobby/countdown/active/finished)

Client: ViewStore
  ├── ConfirmedState (last server tick)
  ├── PendingIntents (awaiting ack)
  └── LocalOverlay (ghost preview, cursor, selections)
```

### Key Data Flows

1. **Lobby/team flow:** `room:create/join -> team:assign -> team:ready -> match:start` guarded by lifecycle reducer.
2. **Deterministic simulation flow:** `build intent -> queue at executeTick -> tick reducer -> conway step -> win check`.
3. **UI synchronization flow:** `delta stream + periodic snapshot + resync endpoint` with monotonic tick checks.
4. **Reconnect flow:** temporary disconnect uses Socket.IO recovery when possible; otherwise full snapshot bootstrap.

## Build Order and Dependency Map

| Step | Deliverable                                                         | Depends On | Why This Order                                                        |
| ---- | ------------------------------------------------------------------- | ---------- | --------------------------------------------------------------------- |
| 1    | Shared protocol contracts (`packages/protocol`) + typed sockets     | none       | Prevents contract drift before adding more events                     |
| 2    | Lobby/team state machine + server handlers                          | Step 1     | Lobby-first is the milestone priority and unlocks reliable room entry |
| 3    | Match lifecycle coordinator (`lobby/countdown/active/finished`)     | Step 2     | Defines allowed actions before deep simulation work                   |
| 4    | Deterministic command queue upgrade (ghost commit/build scheduling) | Step 3     | Gameplay actions must run under phase and tick guarantees             |
| 5    | UI store split + rAF renderer + pending intent UX                   | Steps 1-4  | UI sync should consume stable protocol/lifecycle, not shape them      |
| 6    | Resync/reconnect hardening + delta/snapshot channel                 | Steps 3-5  | Recovery semantics require stable lifecycle and state metadata        |

## Test-Driven Development Notes

### Deterministic Test Seams

- **`transitionLobbyState(state, event)` seam:** unit-test legal and illegal phase transitions without sockets.
- **`reduceMatchTick(state, commands)` seam:** replay command logs and assert byte-identical grid hashes/winner.
- **`validateIntent(payload, context)` seam:** fuzz malformed/stale/out-of-phase intents at pure function boundary.
- **`encode/decode state payload` seam:** roundtrip tests for snapshot/delta serialization fidelity.

### Runtime Boundary Tests

- Integration tests: two-client lobby team assignment, ready gating, countdown start, and room-scoped broadcasts.
- Integration tests: command ack/reject behavior (including timeout/retry paths), then deterministic execution at expected tick.
- Integration tests: disconnect + reconnect with both recovered and unrecovered paths.
- Contract tests: compile-time event typing plus runtime schema validation failures.

### Determinism Guardrails

- Keep `Date.now()`, random selection, and side effects out of package reducers.
- Inject clock/tick externally from scheduler.
- Order same-tick command execution deterministically (`executeTick`, then `teamId`, then `commandId`).
- Keep replay fixtures as golden tests for regression detection.

## Scaling Considerations

| Scale         | Architecture Adjustments                                                                             |
| ------------- | ---------------------------------------------------------------------------------------------------- |
| 0-1k users    | Single Node process, in-memory rooms, full snapshots acceptable for MVP                              |
| 1k-100k users | Sticky sessions + multi-node adapter, room sharding, snapshot+delta required                         |
| 100k+ users   | Regional match clusters, external room directory, persistent event streams, aggressive load shedding |

### Scaling Priorities

1. **First bottleneck:** full-grid encode/broadcast every tick; fix with deltas and periodic keyframes.
2. **Second bottleneck:** single-process room scheduler; fix with room partitioning across workers/nodes.

## Anti-Patterns

### Anti-Pattern 1: No Explicit Match Phase Boundaries

**What people do:** Keep lobby + gameplay in one mutable object with ad-hoc boolean checks.
**Why it's wrong:** Creates race conditions (start/leave/build overlap) and brittle handlers.
**Do this instead:** Central phase reducer that gates every command by phase.

### Anti-Pattern 2: Client-Driven Grid Mutation in Competitive Path

**What people do:** Accept raw `cell:update` as primary gameplay operation.
**Why it's wrong:** Breaks authority model, encourages desync/cheat vectors, bypasses resource and territory rules.
**Do this instead:** Treat raw cell updates as debug-only; use scheduled server-validated commands for gameplay.

### Anti-Pattern 3: Transport-Coupled Rendering

**What people do:** Re-render entire canvas directly in every socket callback.
**Why it's wrong:** Causes jank and inconsistent visual pacing under packet bursts.
**Do this instead:** Apply network updates to store; render on `requestAnimationFrame` with latest confirmed tick.

## Integration Points

### External Services

| Service                                     | Integration Pattern                             | Notes                                                                                 |
| ------------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------- |
| Socket.IO rooms/adapters                    | Room-scoped broadcast and membership channels   | Rooms are server-only concept; keep room membership authoritative on server           |
| Socket.IO connection recovery               | Enable for short disconnect continuity          | Works with in-memory adapter; Redis adapter does not support this feature             |
| Redis Streams adapter (optional scale step) | Cross-node packet forwarding + recovery support | Prefer this over classic Redis Pub/Sub if connection recovery must survive multi-node |

### Internal Boundaries

| Boundary                                              | Communication              | Notes                                                                |
| ----------------------------------------------------- | -------------------------- | -------------------------------------------------------------------- |
| `apps/server/socket` ↔ `packages/protocol`            | Typed DTO + runtime schema | Prevent drift and reject malformed payloads early                    |
| `apps/server/lifecycle` ↔ `packages/rts-engine/lobby` | Pure transitions           | Enables deterministic unit tests and easier host/team policy changes |
| `apps/server/tick` ↔ `packages/rts-engine/match`      | Fixed-step reducer calls   | Keep scheduler impure, engine pure                                   |
| `apps/web/socket` ↔ `apps/web/state`                  | Action dispatch            | Centralizes reconciliation and pending-intent cleanup                |

## Confidence and Gaps

- **HIGH confidence:** Socket.IO room semantics, delivery guarantees, acknowledgements/timeouts/retries, connection recovery behavior, adapter compatibility, sticky session requirements.
- **HIGH confidence:** Node timer behavior (no exact callback timing guarantees) and browser `requestAnimationFrame` behavior.
- **MEDIUM confidence:** Recommended deterministic replay and command-ordering approach for this exact RTS domain (based on existing code + established game networking practice).
- **LOW confidence:** Large-scale (100k+) architecture details are directional because this milestone is explicitly prototype-scoped and has no production traffic profile yet.

## Sources

- Project context and current implementation: `/workspace/.planning/PROJECT.md`, `/workspace/conway-rts/DESIGN.md`, `apps/server/src/server.ts`, `apps/web/src/client.ts`, `packages/rts-engine/src/rts.ts`, `packages/conway-core/src/grid.ts`, `tests/integration/server/server.test.ts` (HIGH)
- Socket.IO Rooms (updated Jan 22, 2026): https://socket.io/docs/v4/rooms/ (HIGH)
- Socket.IO Delivery guarantees (updated Jan 22, 2026): https://socket.io/docs/v4/delivery-guarantees (HIGH)
- Socket.IO Connection state recovery (updated Jan 22, 2026): https://socket.io/docs/v4/connection-state-recovery (HIGH)
- Socket.IO TypeScript typing (updated Jan 22, 2026): https://socket.io/docs/v4/typescript/ (HIGH)
- Socket.IO Emitting events / acknowledgements / volatile events (updated Jan 22, 2026): https://socket.io/docs/v4/emitting-events/ (HIGH)
- Socket.IO Client offline behavior (updated Jan 22, 2026): https://socket.io/docs/v4/client-offline-behavior/ (HIGH)
- Socket.IO Client options (`retries`, `ackTimeout`, transport behavior; updated Jan 22, 2026): https://socket.io/docs/v4/client-options/#retries (HIGH)
- Socket.IO multiple nodes + sticky sessions (updated Jan 22, 2026): https://socket.io/docs/v4/using-multiple-nodes/ (HIGH)
- Socket.IO Redis adapter (updated Feb 4, 2026): https://socket.io/docs/v4/redis-adapter/ (HIGH)
- Socket.IO Redis Streams adapter (updated Feb 9, 2026): https://socket.io/docs/v4/redis-streams-adapter/ (HIGH)
- Node.js Timers API (v25 docs): https://nodejs.org/api/timers.html (HIGH)
- MDN `requestAnimationFrame` (modified Dec 26, 2025): https://developer.mozilla.org/en-US/docs/Web/API/Window/requestAnimationFrame (HIGH)
- Glenn Fiedler, fixed timestep + networking model (2004/2010; historical but still relevant): https://gafferongames.com/post/fix_your_timestep/ and https://gafferongames.com/post/what_every_programmer_needs_to_know_about_game_networking/ (LOW)

---

_Architecture research for: Conway RTS TypeScript prototype_
_Researched: 2026-02-27_
