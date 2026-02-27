# Phase 3: Deterministic Build Queue Validation - Research

**Researched:** 2026-02-27
**Domain:** Authoritative build queue validation, deterministic terminal outcomes, and gameplay-mutation gate hardening
**Confidence:** HIGH

<user_constraints>

## User Constraints (from CONTEXT.md)

No `*-CONTEXT.md` file exists for this phase (`.planning/phases/03-deterministic-build-queue-validation`).

### Locked Decisions

- Phase 3 must ensure construction actions go through a deterministic validated build queue with explicit outcomes.
- This phase MUST address: `BUILD-01`, `BUILD-02`, `BUILD-03`, `BUILD-04`.
- Keep server-authoritative architecture (runtime in `apps/*`, deterministic logic in `packages/*`).

### OpenCode's Discretion

- Terminal build outcome event naming and payload shape.
- Whether terminal outcomes are emitted only to the requesting player or room-scoped to all participants.
- Exact test split between `packages/rts-engine/rts.test.ts` and `tests/integration/server/server.test.ts`.

### Deferred Ideas (OUT OF SCOPE)

- Economy HUD/resource affordance work (`ECON-*`, Phase 4).
- Queue timeline UX work (`UX-01`, Phase 4).
- Phase-5 broad quality-gate expansion beyond Phase-3 requirement coverage.

</user_constraints>

<phase_requirements>

## Phase Requirements

| ID       | Description                                                                                          | Research Support                                                                                                                                                                          |
| -------- | ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| BUILD-01 | User can queue a template build and receives queued acknowledgement with execute tick.               | Keep `queueBuildEvent()` as the single enqueue validator and preserve `build:queued { eventId, executeTick }` acknowledgement contract.                                                   |
| BUILD-02 | Every queued build reaches a terminal outcome: `applied` or `rejected(reason)`.                      | Add explicit per-event terminal outcome emission sourced from deterministic engine results; flush unresolved pending events on terminal match transitions with explicit rejection reason. |
| BUILD-03 | Gameplay mutations are accepted only through validated queue paths (no direct bypass mutation path). | Remove/block `cell:update` gameplay mutation path and enforce one authoritative mutation gate that only permits validated queued build intents.                                           |
| BUILD-04 | Build validation enforces bounds and territory constraints with explicit rejection messages.         | Preserve/expand structured validation reasons (`out-of-bounds`, `outside-territory`, etc.) and surface them in terminal outcome payloads (not just internal timeline metadata).           |

</phase_requirements>

## Summary

The core queue domain is already present and mostly deterministic in `packages/rts-engine/rts.ts`: `queueBuildEvent()` validates player/team/template/payload, enforces bounds/territory, computes `executeTick`, increments monotonic `eventId`, and appends timeline entries (`build-queued`, `build-rejected`, `build-applied`). That gives a strong base for `BUILD-01` and much of `BUILD-04`.

The largest Phase-3 gap is terminal outcome delivery and closure guarantees. Today, terminal outcomes are tracked in `room.timelineEvents` but are not emitted as a dedicated socket contract event. Also, pending events can be silently dropped (for example, `team.pendingBuildEvents = []` on defeat) or stranded when room lifecycle transitions to `finished` and ticking stops. This violates `BUILD-02` unless Phase 3 adds explicit per-event terminal outcome emission and deterministic draining/rejection of leftover queued events.

`BUILD-03` is currently blocked by an explicit bypass path: `cell:update` still mutates gameplay via `queueLegacyCellUpdate()` outside build queue validation. Phase 3 planning should treat this as a contract hardening step: all gameplay mutations must go through one validated queue path, with server-side rejection for bypass attempts.

**Primary recommendation:** Keep `queueBuildEvent()` as the only enqueue authority, add a typed `build:outcome` terminal event emitted from deterministic tick results, and eliminate `cell:update` as a gameplay mutation path.

## Standard Stack

### Core

| Library            | Version         | Purpose                                                                       | Why Standard                                                         |
| ------------------ | --------------- | ----------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `socket.io`        | 4.8.3 (locked)  | Authoritative real-time event contract and room-scoped broadcasts             | Already central to server authority and client synchronization model |
| `socket.io-client` | 4.8.3 (locked)  | Client event consumption for queued and terminal build outcomes               | Keeps one typed transport contract across app/runtime/tests          |
| `typescript`       | 5.9.3 (locked)  | Shared type-safe queue/outcome payload contracts in server/client/engine      | Prevents event-shape drift for Phase-3 contract additions            |
| `vitest`           | 1.6.1 (locked)  | Deterministic unit and integration verification of queue lifecycle invariants | Existing test runner used in package and integration suites          |
| `express`          | 4.22.1 (locked) | Existing runtime host for Socket.IO server                                    | No migration required for this phase                                 |

### Supporting

| Library                         | Version         | Purpose                                                               | When to Use                                                |
| ------------------------------- | --------------- | --------------------------------------------------------------------- | ---------------------------------------------------------- |
| `#rts-engine` package APIs      | in-repo current | Deterministic queue state transitions (`queueBuildEvent`, `tickRoom`) | All mutation/validation rules should stay in package layer |
| `#rts-engine/socket-contract`   | in-repo current | Shared server/client event payload typing                             | Add terminal outcome contract fields here first            |
| JS `Map`/`Array.sort` semantics | ES2019+         | Deterministic event ordering and ranking                              | Use explicit comparator with tie-break fallback keys       |

### Alternatives Considered

| Instead of                                               | Could Use                                           | Tradeoff                                                                                                          |
| -------------------------------------------------------- | --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Dedicated terminal event (`build:outcome`)               | Socket.IO callback acknowledgement for each request | Ack only covers immediate request/response; it does not model delayed tick-time outcomes cleanly                  |
| Room-scoped terminal outcomes                            | Requester-only unicast outcomes                     | Unicast is lighter, but room-wide visibility helps observers/integration assertions and reduces client divergence |
| Explicit queue tie-break (`executeTick`, then `eventId`) | Rely on stable sort behavior only                   | Stable sort is usually fine on modern runtimes, but explicit tie-break keeps determinism obvious and portable     |

**Installation:**

```bash
# No new dependencies are required for this phase.
npm install
```

## Architecture Patterns

### Recommended Project Structure

```text
packages/rts-engine/
├── rts.ts                 # queue validation, deterministic tick processing, terminal outcome records
├── socket-contract.ts     # shared build queue + terminal outcome payload types
└── rts.test.ts            # queue validation and terminal-outcome unit tests

apps/server/src/
└── server.ts              # socket handlers, mutation gate, and room-scoped terminal outcome emission

tests/integration/server/
└── server.test.ts         # end-to-end queue ack + terminal outcome + bypass rejection coverage
```

### Pattern 1: Two-Stage Deterministic Queue Pipeline

**What:** Enqueue validates intent now; tick resolves to terminal outcome later.
**When to use:** All build requests from socket boundary to grid mutation.
**Example:**

```typescript
// Source: /workspace/packages/rts-engine/rts.ts
const result = queueBuildEvent(room, playerId, payload); // enqueue-time validation
const tickResult = tickRoom(room); // deterministic terminal resolution on due events
```

### Pattern 2: Explicit Terminal Outcome Contract

**What:** Every accepted queue event emits exactly one terminal event (`applied` or `rejected` + reason).
**When to use:** After each `tickRoom()` call and on terminal lifecycle transitions that cancel pending events.
**Example:**

```typescript
// Source: Socket.IO emit semantics: https://socket.io/docs/v4/emitting-events/
io.to(roomChannel(roomId)).emit('build:outcome', {
  eventId,
  outcome: 'rejected',
  reason: 'outside-territory',
  resolvedTick,
});
```

### Pattern 3: Single Gameplay Mutation Gate

**What:** Route gameplay mutations only through validated queue path; reject bypasses at server boundary.
**When to use:** `build:queue`, `cell:update`, and any future mutation event.
**Example:**

```typescript
// Source: /workspace/apps/server/src/server.ts (existing mutation gate pattern)
if (!assertGameplayMutationAllowed(room, sessionId).allowed) {
  socket.emit('room:error', {
    message: 'Gameplay mutation rejected',
    reason: 'invalid-state',
  });
  return;
}
```

### Pattern 4: Deterministic Intra-Tick Ordering With Explicit Tie-Break

**What:** For same `executeTick`, order by `eventId` to avoid environment-dependent behavior.
**When to use:** Sorting pending queue events before tick processing.
**Example:**

```typescript
// Source: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/sort
team.pendingBuildEvents.sort(
  (a, b) => a.executeTick - b.executeTick || a.id - b.id,
);
```

### Anti-Patterns to Avoid

- **Timeline-only terminal outcomes:** `timelineEvents` without socket contract emission does not satisfy explicit user-facing terminal outcomes.
- **Silent queue drops on defeat/finish:** clearing pending events without per-event rejection reason breaks `BUILD-02` closure.
- **Dual mutation paths (`build:queue` + `cell:update`):** bypass path undermines validated-queue-only requirement.
- **Generic rejection only (`reason: build-rejected`):** opaque server errors reduce debuggability and weaken requirement-level assertions.

## Don't Hand-Roll

| Problem                                        | Don't Build                                            | Use Instead                                                    | Why                                                                                                                 |
| ---------------------------------------------- | ------------------------------------------------------ | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Event transport/reliability semantics          | Custom socket protocol on top of raw ws for this phase | Existing Socket.IO event contract + authoritative state resync | Current stack already provides ordering and room fanout; this phase needs contract hardening, not transport rewrite |
| Client/server payload duplication              | Separate ad-hoc interfaces in app and tests            | Shared `packages/rts-engine/socket-contract.ts` types          | Prevents drift when adding terminal outcome payloads                                                                |
| Mutation authorization spread across handlers  | Handler-specific one-off checks                        | One reusable gameplay mutation gate function                   | Keeps `BUILD-03` enforceable and testable                                                                           |
| Queue-resolution bookkeeping in server runtime | Recompute outcome state in `server.ts`                 | Engine-owned deterministic outcome record emitted by server    | Avoids runtime/domain divergence and duplicate logic                                                                |

**Key insight:** Keep determinism and validation in `packages/rts-engine`, and keep server role limited to boundary validation + event emission.

## Common Pitfalls

### Pitfall 1: Queued Events Never Reach Terminal Outcome

**What goes wrong:** Accepted events remain unresolved when match finishes or a team is defeated.
**Why it happens:** Tick processing stops in `finished`, and pending arrays may be cleared without explicit outcome emission.
**How to avoid:** Add a deterministic pending-event drain step that emits `rejected(reason)` for every unresolved event on terminal transitions.
**Warning signs:** `build:queued` observed with matching `eventId`, but no later `applied`/`rejected` notification.

### Pitfall 2: Bypass Mutations Still Alter Gameplay

**What goes wrong:** `cell:update` mutates grid outside validated queue path.
**Why it happens:** Legacy path (`queueLegacyCellUpdate`) remains callable during gameplay.
**How to avoid:** Disable gameplay `cell:update` path (or route it into validated queue semantics) and enforce server rejection reason.
**Warning signs:** Player can alter board without receiving `build:queued`/terminal build outcomes.

### Pitfall 3: Rejection Reasons Inconsistent Across Stages

**What goes wrong:** Enqueue-time rejections are explicit, but tick-time rejections are opaque or missing to clients.
**Why it happens:** Internal timeline reason strings are not mapped into socket contract payloads.
**How to avoid:** Define a shared reason enum and use it in both immediate and delayed terminal responses.
**Warning signs:** Integration tests can only assert generic `room:error` message text.

### Pitfall 4: Queue Ordering Ambiguity For Same Execute Tick

**What goes wrong:** Same-tick builds process in non-obvious order across refactors/runtimes.
**Why it happens:** Ordering relies on incidental insertion/stability behavior instead of explicit tie-break fields.
**How to avoid:** Sort by `executeTick` then `eventId` and document this as contract.
**Warning signs:** Flaky assertions when two builds share the same `executeTick`.

### Pitfall 5: Terminal Outcome Event Missed During Disconnect

**What goes wrong:** Client misses terminal outcome and local queue UI diverges.
**Why it happens:** Socket.IO server does not buffer missed events for disconnected clients by default.
**How to avoid:** Treat server `state` snapshot as authoritative recovery surface and reconcile pending UI state on reconnect.
**Warning signs:** Reconnected client still shows pending build for event already applied/rejected server-side.

## Code Examples

Verified patterns from official and in-repo sources:

### Immediate Queue Acknowledgement

```typescript
// Source: /workspace/apps/server/src/server.ts
const queued = {
  eventId: result.eventId ?? -1,
  executeTick: result.executeTick ?? room.state.tick,
};
socket.emit('build:queued', queued);
```

### Room-Scoped Terminal Outcome Broadcast

```typescript
// Source: https://socket.io/docs/v4/rooms/
io.to(roomChannel(roomId)).emit('build:outcome', {
  eventId,
  outcome: 'applied',
  resolvedTick,
});
```

### Deterministic Queue Sort Comparator

```typescript
// Source: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/sort
pending.sort((a, b) => a.executeTick - b.executeTick || a.id - b.id);
```

### Typed Shared Socket Contract

```typescript
// Source: /workspace/packages/rts-engine/socket-contract.ts
export interface ServerToClientEvents {
  'build:queued': (payload: BuildQueuedPayload) => void;
  'build:outcome': (payload: BuildOutcomePayload) => void;
}
```

## State of the Art

| Old Approach                                                                      | Current Approach                                                                 | When Changed   | Impact                                                                 |
| --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | -------------- | ---------------------------------------------------------------------- |
| Direct cell edits (`cell:update`) and queued template builds both mutate gameplay | Queue-only gameplay mutation path with explicit validation and rejection reasons | Phase 3 target | Satisfies `BUILD-03` and improves authority consistency                |
| `build:queued` acknowledgement without explicit terminal socket event             | `build:queued` + required `build:outcome` terminal event                         | Phase 3 target | Satisfies `BUILD-02` observability and enables deterministic client UX |
| Internal timeline rejection metadata only                                         | Public, typed rejection reasons in socket payloads                               | Phase 3 target | Makes `BUILD-04` testable at contract boundary                         |
| Potential silent pending-event drops on defeat/finish                             | Deterministic pending-event drain to terminal `rejected(reason)`                 | Phase 3 target | Guarantees queue closure for every accepted event                      |

**Deprecated/outdated:**

- Treating `cell:update` as a valid gameplay mutation path during active matches.
- Assuming timeline tracking alone is enough for explicit player-facing terminal outcomes.

## Open Questions

1. **Terminal event visibility scope (requester vs room-wide)**
   - What we know: Terminal outcome must be explicit and deterministic.
   - What's unclear: Product expectation for spectator/opponent visibility of each outcome.
   - Recommendation: Use room-wide emission unless product explicitly asks for requester-only privacy.

2. **Canonical rejection reason taxonomy**
   - What we know: Internal reasons already exist (`out-of-bounds`, `outside-territory`, `insufficient-resources`, etc.).
   - What's unclear: Final public enum surface and backward-compatibility policy for reason strings.
   - Recommendation: Freeze a documented reason enum in `socket-contract.ts` during this phase.

3. **How to represent resolution tick semantics**
   - What we know: Queue ack provides `executeTick`; terminal events should include deterministic context.
   - What's unclear: Whether payload should include `resolvedTick`, `executeTick`, or both.
   - Recommendation: Include both for auditability and easier integration assertions.

## Sources

### Primary (HIGH confidence)

- `/workspace/packages/rts-engine/rts.ts` - queue validation, timeline reasons, tick ordering, defeat behavior, and pending-event handling.
- `/workspace/packages/rts-engine/socket-contract.ts` - current typed socket event contract and missing terminal build outcome event.
- `/workspace/apps/server/src/server.ts` - `build:queue` handling, `build:queued` emission, mutation gate usage, and current `cell:update` bypass path.
- `/workspace/packages/rts-engine/rts.test.ts` - existing queue validation and rejection reason unit coverage baseline.
- `/workspace/tests/integration/server/server.test.ts` - current end-to-end build queue happy-path coverage baseline.
- `https://socket.io/docs/v4/emitting-events/` (last updated Jan 22, 2026) - emit/ack semantics for explicit request/response contracts.
- `https://socket.io/docs/v4/delivery-guarantees/` (last updated Jan 22, 2026) - ordering guarantees and default at-most-once delivery caveats.
- `https://socket.io/docs/v4/rooms/` (last updated Jan 22, 2026) - room-scoped broadcast patterns for authoritative outcomes.
- `https://socket.io/docs/v4/tutorial/handling-disconnections` (last updated Jan 22, 2026) - missed-event behavior during disconnect.
- `https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/sort` (last modified Jul 20, 2025) - comparator and stability semantics.

### Secondary (MEDIUM confidence)

- `/workspace/conway-rts/DESIGN.md` - legacy design intent for event-centric, future-scheduled placement model.

### Tertiary (LOW confidence)

- None.

## Metadata

**Confidence breakdown:**

- Standard stack: HIGH - package versions are verified in `package-lock.json`, and transport behavior is verified in official Socket.IO docs.
- Architecture: HIGH - queue and bypass gaps are directly observable in current engine/server code paths.
- Pitfalls: HIGH - each pitfall maps to concrete current behavior or official delivery semantics.

**Research date:** 2026-02-27
**Valid until:** 2026-03-29
