# Phase 2: Match Lifecycle & Breach Outcomes - Research

**Researched:** 2026-02-27
**Domain:** Authoritative lifecycle transitions, breach outcomes, defeat lockout, restart semantics
**Confidence:** MEDIUM

<user_constraints>

## User Constraints (from CONTEXT.md)

### Locked Decisions

### Start Preconditions & Countdown Flow

- Start/restart is allowed only when exactly one player is assigned to each team, both are connected, and no reconnect-hold is pending.
- Countdown duration is 3 seconds.
- Countdown UI shows a prominent center overlay plus room status line.
- Host may cancel countdown any time before countdown reaches 0.
- Disconnect during countdown does not cancel countdown.

### Canonical Breach Outcome Rule

- A team is defeated when its core structure is destroyed.
- Core structures use HP-based restore behavior per `conway-rts/DESIGN.md`: on periodic restore checks, structure HP is consumed to restore expected local state; once HP reaches 0, the structure is dead/destroyed.
- Breach evaluation is authoritative and deterministic.
- If multiple teams breach on the same tick, resolve via deterministic tie-breaker from authoritative snapshot data.
- On breach resolution, transition immediately to `finished` and freeze gameplay actions.

### Defeat Lockout Experience

- Defeated users are hard-blocked from all gameplay mutation actions.
- Defeated users remain in read-only mode with live board/HUD/results visibility.
- Defeat UI is persistent and explicit: defeat banner/overlay, disabled gameplay controls, and reason text.
- Server rejects blocked actions with explicit reason `defeated`; client surfaces that reason.
- Defeated users see "spectating" wording to reinforce read-only mode.

### Finished-State UX and Restart Controls

- `finished` shows a centered results panel to all players.
- Results panel is minimizable.
- Minimized panel keeps key action buttons visible/pinned.
- Restart control is host-only; non-host sees disabled restart with waiting-for-host messaging.
- Users may return to lobby client-side at any time while in `finished`.
- If host restarts, replace results panel immediately with countdown overlay.
- If a user already returned to lobby and is still a valid room member/session, host restart pulls them back into restarted countdown flow.

### Restart Semantics

- Restart performs a full reset: map state, structures/HP, queues, economy, defeat flags, and prior results state/UI.
- Team assignments/slots persist by default across restart.
- Restart request is rejected with explicit reason when preconditions are not met; room remains in `finished`.

### Post-Match Statistics Contract

- Always include, per team: outcome, final core-structure HP/state, territory/cell count, and queued/applied/rejected build counts.
- Order teams winner first, then remaining teams by final rank.
- Show absolute values plus compact comparative indicators.
- Track timeline events internally in this phase, but do not display timeline UI yet.

### Multi-Team Future-Proofing

- Use multi-team-safe terminology now: `winner` + `defeated`/`eliminated` (avoid binary `loser` assumptions).
- Final results model/UX supports ranked standings (1st, 2nd, 3rd, ...) with per-team stats.
- Same-tick multi-team elimination rank conflicts resolve via deterministic snapshot tie-breaker.
- Player-facing copy and contracts in this phase avoid 1v1-only wording.

### In-Match Disconnect Behavior

- During `active`, simulation continues if a player disconnects (no pause).
- Connected player sees a small persistent disconnect status indicator.
- If disconnected player reclaims within window, restore immediately with authoritative resync and control recovery.
- If reconnect window expires, match remains `active`; breach remains the only terminal outcome in this phase.

### Chat and Read-Only Behavior by Lifecycle State

- Room chat remains available in `countdown`, `active`, `finished`, and defeated read-only states.
- Defeated/read-only users can still chat, minimize the results panel, and return to lobby.
- Defeated/read-only users keep full board and HUD visibility.

### Additional Locked Decision (from current request)

- Structure instances should include a build radius property representing the square of expanded build area while that structure is active. Naming/behavior must align with the README structure-template/build-area concept.

### OpenCode's Discretion

- Exact deterministic metric used for same-tick tie-break snapshots (must be documented and stable).
- Final visual styling and copy polish for overlays, badges, and panels, while preserving all locked semantics above.

### Deferred Ideas (OUT OF SCOPE)

- Separate disconnect-timeout terminal loss reason (distinct from breach) — future phase.
- Timeline event display in post-match UI (events may be tracked now but not shown) — future phase.
- Results panel zoom controls — future phase.

</user_constraints>

<phase_requirements>

## Phase Requirements

| ID       | Description                                                                                                                                      | Research Support                                                                                                                                                                                                                       |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MATCH-01 | Host can start a match only when lifecycle preconditions are met, and room state transitions through `lobby -> countdown -> active -> finished`. | Add an explicit lifecycle reducer and server-side guards for start/cancel/restart preconditions, then gate room tick/action handling by phase.                                                                                         |
| MATCH-02 | Match uses one canonical breach rule and ends with explicit winner/loser outcomes.                                                               | Model core structures as authoritative instances (`hp`, `active`, `buildRadius`, `isCore`), run deterministic same-tick breach ranking, emit final standings/results snapshot, and transition immediately to `finished`.               |
| MATCH-03 | Defeated user is locked out of gameplay actions and sees clear defeat status.                                                                    | Enforce mutation guardrails at server boundaries (`build:queue`, `cell:update`, future mutation events) with explicit `reason: defeated`, keep read-only board/chat visibility, and surface persistent defeat/spectating UX on client. |

</phase_requirements>

## Summary

This phase should be planned as a lifecycle-and-authority hardening pass, not a UI-only pass. The current runtime already has `lobby -> countdown -> active` in `apps/server/src/server.ts`, but it has no `finished` phase, no canonical room-level outcome payload, and no restart path. It also allows gameplay mutations without checking lifecycle phase (for example, `build:queue` and `cell:update` handlers currently do not enforce `active`/`finished` restrictions), so defeat/freeze semantics from the locked decisions cannot be guaranteed yet.

The existing engine (`packages/rts-engine/rts.ts`) tracks `team.defeated`, but match completion is not room-authoritative: the server tick loop keeps stepping all rooms, and active disconnect expiry currently removes players/teams, which conflicts with "breach is the only terminal outcome in this phase." Planning should separate room lifecycle ownership (server runtime) from deterministic breach evaluation (engine package), then connect them through explicit phase transitions and final-results emission.

For deterministic same-tick outcomes, use a documented total-order comparator over authoritative snapshot metrics, with explicit final fallback (`teamId`) to avoid ambiguous ordering. Also include the locked structure-model decision now: structure instances need `buildRadius` (active square expansion) aligned with README `buildArea` semantics, so lifecycle/outcome and future territory logic use one authoritative structure model.

**Primary recommendation:** Implement a pure match lifecycle/outcome reducer in `packages/rts-engine` and call it from server room handlers so all start/cancel/restart/finish behavior, defeat lockout, and deterministic ranking are enforced by one authority path.

## Standard Stack

### Core

| Library            | Version                 | Purpose                                                                           | Why Standard                                                                                 |
| ------------------ | ----------------------- | --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `socket.io`        | `^4.7.5` (repo current) | Server transport, room-scoped lifecycle/event fanout                              | Official room/disconnect semantics and server-only room authority map directly to this phase |
| `socket.io-client` | `^4.8.3` (repo current) | Client event consumption and reconnect behavior                                   | Supports session-auth handshake + reconnect flow used in this codebase                       |
| `typescript`       | `^5.4.5`                | Shared strict typing for lifecycle, outcomes, and payload contracts               | Required for stable server/client/package contract evolution                                 |
| `vitest`           | `^1.6.0`                | Unit/integration verification of lifecycle transitions and deterministic outcomes | Existing project runner; fake timers support deterministic countdown tests                   |
| `express`          | `^4.19.2`               | Existing HTTP/socket runtime host                                                 | Already integrated in `apps/server/src/server.ts`; no migration needed                       |

### Supporting

| Library                                               | Version      | Purpose                                            | When to Use                                                                            |
| ----------------------------------------------------- | ------------ | -------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Node timers (`setInterval`/`setTimeout`)              | Node runtime | Countdown/tick scheduling                          | Runtime lifecycle scheduling (`countdown`, global tick), plus cancellable restart flow |
| `LobbySessionCoordinator` (in-repo)                   | current      | Reconnect hold ownership and slot reclaim priority | Enforcing start/restart preconditions: both players connected and no hold pending      |
| JS `Array.prototype.sort` + `Map` iteration semantics | ES2019+      | Deterministic ranking/order construction           | Same-tick elimination tie-break and stable standings generation                        |

### Alternatives Considered

| Instead of                                    | Could Use                                                            | Tradeoff                                                             |
| --------------------------------------------- | -------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Ad-hoc booleans in `server.ts`                | Reducer-style lifecycle transition function in `packages/rts-engine` | Slight upfront refactor, much lower long-term race/regression risk   |
| Manual wall-clock integration countdown tests | Vitest fake timers (`vi.useFakeTimers`)                              | Fake timers require test isolation, but remove flaky real-time waits |
| Implicit iteration-order tie-break            | Explicit comparator chain + final `teamId` fallback                  | More code, but deterministic and auditable across replays/tests      |

**Installation:**

```bash
# No new package is required for this phase.
npm install
```

## Architecture Patterns

### Recommended Project Structure

```text
apps/server/src/
├── server.ts                     # Socket handlers + runtime room orchestration
├── lobby-session.ts              # Reconnect hold and session ownership
└── (new) match-lifecycle.ts      # Runtime glue for start/cancel/restart/finish transitions

packages/rts-engine/
├── rts.ts                        # Deterministic room/team/structure state and tick functions
└── (new) match-outcomes.ts       # Breach evaluation, ranking comparator, results model

apps/web/src/
└── client.ts                     # Lifecycle UI (countdown, finished/results, defeat lockout)

tests/integration/server/
└── (new) match-lifecycle.test.ts # End-to-end lifecycle + defeat/read-only + restart contract
```

### Pattern 1: Explicit Lifecycle Reducer with Guarded Transitions

**What:** Model room lifecycle as explicit transitions: `lobby -> countdown -> active -> finished`, plus `countdown -> lobby` (host cancel) and `finished -> countdown` (host restart when preconditions pass).
**When to use:** Every lifecycle event (`room:start`, countdown tick, cancel, breach finish, restart).
**Example:**

```typescript
// Source: apps/server/src/server.ts and phase decisions
type RoomStatus = 'lobby' | 'countdown' | 'active' | 'finished';

function canStart(room: RuntimeRoom): boolean {
  return (
    room.status === 'lobby' &&
    exactlyOnePlayerPerTeam(room) &&
    bothPlayersConnected(room) &&
    noReconnectHoldPending(room)
  );
}
```

### Pattern 2: Server-Side Mutation Gate by Lifecycle + Defeat State

**What:** Centralize gameplay mutation authorization before calling engine mutators.
**When to use:** `build:queue`, `cell:update`, and any future gameplay mutation socket event.
**Example:**

```typescript
// Source: apps/server/src/server.ts (event boundary validation pattern)
function assertGameplayMutationAllowed(
  room: RuntimeRoom,
  sessionId: string,
): string | null {
  if (room.status !== 'active') return 'invalid-state';
  if (isSessionDefeated(room.state, sessionId)) return 'defeated';
  return null;
}
```

### Pattern 3: Deterministic Same-Tick Breach Ranking (Total Order)

**What:** Resolve same-tick multi-team elimination with a stable, documented comparator over authoritative snapshot data.
**When to use:** Breach evaluation at tick boundary when 2+ teams are eliminated in the same tick.
**Recommended tie-break metric:** `coreHpBeforeResolution` (desc) -> `territoryCellCount` (desc) -> `appliedBuildCount` (desc) -> `teamId` (asc).
**Example:**

```typescript
// Source: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/sort
const ranked = [...teams].sort(
  (a, b) =>
    b.coreHpBeforeResolution - a.coreHpBeforeResolution ||
    b.territoryCellCount - a.territoryCellCount ||
    b.appliedBuildCount - a.appliedBuildCount ||
    a.teamId - b.teamId,
);
```

### Pattern 4: Structure Instance as Authoritative Runtime Record

**What:** Store core lifecycle and territory-relevant structure fields on instance records.
**When to use:** Integrity checks, HP restore/destruction, territory expansion, and results snapshot construction.
**Example:**

```typescript
// Source: /workspace/conway-rts/README.md (StructureTemplate buildArea semantics)
interface StructureInstance {
  key: string;
  templateId: string;
  x: number;
  y: number;
  active: boolean;
  hp: number;
  isCore: boolean;
  buildRadius: number; // 0 when inactive, template.buildArea when active
}
```

### Anti-Patterns to Avoid

- **No room-level finished authority:** `team.defeated` alone is not enough; room status must transition to `finished` and freeze gameplay.
- **Lifecycle checks scattered per handler:** use one guard path to avoid drift between `build:queue`, `cell:update`, and future mutations.
- **Disconnect timeout removing active teams:** this creates non-breach terminal behavior; keep match active and breach-only terminal outcome.
- **Undocumented tie-breaks (or random tie-break):** use one explicit comparator and include final deterministic fallback key.

## Don't Hand-Roll

| Problem                                   | Don't Build                                      | Use Instead                                                             | Why                                                                        |
| ----------------------------------------- | ------------------------------------------------ | ----------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Room-targeted lifecycle fanout            | Custom room membership bus                       | Socket.IO rooms (`socket.join`, `io.to(room).emit`)                     | Official server-only room model already matches authoritative room control |
| Reliable disconnect semantics assumptions | "Best effort" custom replay logic with no resync | Authoritative snapshot resync + documented Socket.IO reconnect behavior | Socket.IO docs are explicit that missed events are lost while disconnected |
| Countdown test clock control              | Sleep-based real-time test loops                 | Vitest fake timers (`vi.useFakeTimers`, `vi.advanceTimersByTime`)       | Deterministic, fast, non-flaky countdown and restart tests                 |
| Elimination ordering                      | Implicit `Map` iteration order only              | Explicit total-order comparator and stable ranking contract             | Keeps same-tick outcomes deterministic and auditable                       |

**Key insight:** Keep transport and scheduling primitives from the existing stack; spend custom code only on deterministic lifecycle guards, canonical breach evaluation, and explicit outcome contracts.

## Common Pitfalls

### Pitfall 1: Start/Restart Preconditions Ignore Reconnect Holds

**What goes wrong:** Match starts/restarts while one slot is held or disconnected.
**Why it happens:** Preconditions only check slot assignment/ready flags, not live connection and hold state.
**How to avoid:** Reuse `LobbySessionCoordinator` hold/connection data in `canStart`/`canRestart` guards.
**Warning signs:** Countdown starts while membership payload still shows `connectionStatus: held`.

### Pitfall 2: Gameplay Mutations Allowed Outside `active`

**What goes wrong:** Builds/cell edits can change state in `lobby`, `countdown`, or `finished`.
**Why it happens:** Socket handlers call engine mutation functions without lifecycle gating.
**How to avoid:** Add a single server-side authorization gate before any mutating event.
**Warning signs:** `build:queued` acknowledged during countdown or after match finish.

### Pitfall 3: Same-Tick Elimination Ordering Is Not Deterministic

**What goes wrong:** Winner/standing order changes between runs for identical snapshots.
**Why it happens:** Missing/partial comparator or comparator not well-formed.
**How to avoid:** Use a documented comparator chain with final total-order fallback key (`teamId`).
**Warning signs:** Replay tests produce different winner order for same tick state.

### Pitfall 4: Defeated Lockout Is UI-Only

**What goes wrong:** Disabled client controls appear correct, but direct emits still mutate server state.
**Why it happens:** Client blocks actions, server does not enforce `reason: defeated` checks at boundary.
**How to avoid:** Enforce defeat lockout in server handlers first; client UX mirrors server authority.
**Warning signs:** Manual socket emit still queues build for defeated team.

### Pitfall 5: Active Disconnect Expiry Changes Match Outcome Path

**What goes wrong:** Team/session cleanup on hold expiry effectively becomes a terminal loss path.
**Why it happens:** Disconnect expiry removes active players/teams in generic leave flow.
**How to avoid:** In `active`, keep team state and continue simulation; disconnect only changes control availability.
**Warning signs:** Active match ends or standings change without breach event.

## Code Examples

Verified patterns from official sources:

### Room-Scoped Authoritative Broadcast

```typescript
// Source: https://socket.io/docs/v4/rooms/
socket.join(`room:${roomId}`);
io.to(`room:${roomId}`).emit('room:membership', membershipSnapshot);
```

### Disconnect Handling with Explicit Reason

```typescript
// Source: https://socket.io/docs/v4/server-socket-instance/#disconnect
io.on('connection', (socket) => {
  socket.on('disconnect', (reason) => {
    markSessionDisconnected(socket.id, reason);
  });
});
```

### Deterministic Countdown Unit Test with Fake Timers

```typescript
// Source: https://v1.vitest.dev/api/vi#vi-usefaketimers
import { vi, expect, test } from 'vitest';

test('countdown reaches active at 3s', () => {
  vi.useFakeTimers();
  startCountdown(room);
  vi.advanceTimersByTime(3000);
  expect(room.status).toBe('active');
  vi.useRealTimers();
});
```

### Comparator Contract for Stable Rankings

```typescript
// Source: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/sort
const byRank = (a: TeamResult, b: TeamResult): number =>
  b.coreHp - a.coreHp ||
  b.territoryCells - a.territoryCells ||
  a.teamId - b.teamId;
```

## State of the Art

| Old Approach                                               | Current Approach                                                                                | When Changed | Impact                                                                            |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ------------ | --------------------------------------------------------------------------------- |
| Runtime status modeled as `lobby/countdown/active` only    | Explicit four-state lifecycle with authoritative `finished` and restart path                    | Phase 2      | Makes terminal outcomes and restart behavior testable and unambiguous             |
| Defeat tracked per-team without room-level final standings | Canonical breach evaluation emits ordered final standings/results snapshot                      | Phase 2      | Enables explicit winner/defeated UX and post-match contract                       |
| Structure instance tracks only placement/active state      | Structure instance includes `hp`, `isCore`, and `buildRadius` aligned with template `buildArea` | Phase 2      | Unifies core destruction, territory expansion semantics, and results payload data |

**Deprecated/outdated:**

- Treating `cell:update` and `build:queue` as lifecycle-agnostic in multiplayer flow.
- Assuming disconnect expiry cleanup in `active` can remove teams without affecting match outcome semantics.
- Inferring winner from iteration order instead of explicit deterministic ranking comparator.

## Open Questions

1. **Core HP baseline and restore cadence constants**
   - What we know: Core destruction must be HP-driven and deterministic.
   - What's unclear: Initial HP and restore-check cadence/amount are not locked in CONTEXT.
   - Recommendation: Lock constants in a phase-level contract (for example `CORE_HP_START`, `CORE_RESTORE_INTERVAL_TICKS`) before implementation tasks.

2. **Final outcome event and payload naming**
   - What we know: Phase requires explicit winner/defeated outcomes and post-match stats.
   - What's unclear: Event naming (`room:match-finished` vs embedding in `state`) and payload split across UI/state channels.
   - Recommendation: Define one authoritative results payload schema and reuse it for both server emission and client panel rendering.

3. **Active disconnect expiry behavior for control ownership**
   - What we know: Match remains active and breach is the only terminal outcome.
   - What's unclear: Whether expired disconnected sessions keep their slot as uncontrollable team or transition to spectator record while preserving team.
   - Recommendation: Preserve team and rank eligibility regardless of session expiry; treat session expiry as control-loss only.

## Sources

### Primary (HIGH confidence)

- `apps/server/src/server.ts` - current lifecycle/status handling, countdown timer flow, socket mutation boundaries
- `apps/server/src/lobby-session.ts` - reconnect hold model and disconnect metadata
- `packages/rts-engine/rts.ts` - deterministic tick order, defeat detection, current structure/team model
- `packages/rts-engine/rts.test.ts` - existing deterministic unit coverage for defeat and queue behavior
- `tests/integration/server/lobby-contract.test.ts` - start precondition/countdown contract baseline
- https://socket.io/docs/v4/rooms/ (last updated Jan 22, 2026) - room semantics, server-only room model, auto-leave on disconnect
- https://socket.io/docs/v4/broadcasting-events/ (last updated Jan 22, 2026) - disconnected clients miss broadcasts
- https://socket.io/docs/v4/server-socket-instance/#disconnect (last updated Jan 22, 2026) - disconnect/disconnecting semantics and reasons
- https://socket.io/docs/v4/tutorial/handling-disconnections (last updated Jan 22, 2026) - server does not store events by default
- https://v1.vitest.dev/api/vi (v1.6 docs) - fake timer APIs compatible with repo's Vitest major version
- https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/sort (last modified Jul 20, 2025) - stable sort and comparator constraints
- https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Map (last modified Feb 16, 2026) - insertion-order iteration semantics

### Secondary (MEDIUM confidence)

- `/workspace/conway-rts/README.md` - legacy domain model language (`StructureTemplate.buildArea` semantics)
- `/workspace/conway-rts/DESIGN.md` - core structure/destruction design intent referenced by locked decisions

### Tertiary (LOW confidence)

- None.

## Metadata

**Confidence breakdown:**

- Standard stack: HIGH - Versions and tools are directly verified from `package.json` and official docs.
- Architecture: MEDIUM - Lifecycle and authority patterns are clear, but HP constants/event schema details are still open.
- Pitfalls: HIGH - Gaps are directly observable in current server/engine code paths.

**Research date:** 2026-02-27
**Valid until:** 2026-03-29
