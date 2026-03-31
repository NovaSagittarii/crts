# Phase 4: Economy HUD & Queue Visibility - Research

**Researched:** 2026-02-28
**Domain:** Server-authoritative economy signaling, affordability validation, and pending-build timeline UX
**Confidence:** HIGH

<user_constraints>

## User Constraints (from CONTEXT.md)

### Locked Decisions

### Affordability feedback

- If a selected build is unaffordable, the queue action is disabled and shows an inline reason.
- If a queue request is rejected, show the rejection reason inline near the queue action.
- Rejection text includes exact resource deficits (needed vs current).
- The build list shows affordability using color state and numeric cost before submission.

### HUD resource readout

- Always display current resources and net income per tick.
- Place this readout near the build panel during active play.
- Resource and income changes use a subtle tick pulse cue.
- Show net-per-tick by default, with deeper income breakdown on hover or expand.

### Queue timeline shape

- Pending builds are visually grouped by execute tick.
- Each queue item shows template, execute tick, and ETA.
- Timing is shown in relative format only (countdown or ETA), not as absolute tick labels.
- The timeline view focuses on pending items only in this phase.

### Income change signaling

- Net income changes show an HUD delta chip.
- Income change cues include a short cause label.
- If net income becomes negative, indicate it with color change only.
- Multiple small changes are aggregated into one cue per tick.

### OpenCode's Discretion

- No areas were explicitly delegated with "you decide".
- OpenCode may choose exact microcopy and visual styling while preserving all locked behaviors above.

### Deferred Ideas (OUT OF SCOPE)

None - discussion stayed within phase scope.

</user_constraints>

<phase_requirements>

## Phase Requirements

| ID      | Description                                                                            | Research Support                                                                                                                                                                                              |
| ------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ECON-01 | User can see current resources and per-tick income in the match HUD.                   | Keep server-authoritative `state` payload as HUD source, add per-tick diff rendering (pulse + delta chip + inline breakdown trigger) in client, and keep values near build controls in `apps/web/index.html`. |
| ECON-02 | User can only queue affordable builds; unaffordable requests are rejected with reason. | Add engine-level affordability precheck before enqueue, retain execution-time revalidation, and include structured deficit details (`needed`, `current`, `deficit`) for inline rejection copy.                |
| ECON-03 | Resource income updates dynamically based on owned structures/territory state.         | Reuse existing engine recomputation (`applyTeamEconomyAndQueue`) and expose enough breakdown metadata for cause labels; render dynamic income deltas from authoritative tick-to-tick state changes.           |
| UX-01   | User can inspect pending builds in a queue timeline organized by execute tick.         | Project pending queue entries from engine state into `RoomStatePayload`, then render a grouped timeline in client sorted by `executeTick` then `eventId`, with relative ETA labels.                           |

</phase_requirements>

## Summary

Phase 4 should build on a strong existing base: the engine already tracks `resources`, recomputes `income` each tick from active structures, and emits terminal `build:outcome` events with deterministic ordering. The client already shows basic resources/income in the header. That means ECON-03 is partially implemented in domain logic, but Phase 4 still needs contract and UI work to satisfy the required affordance and visibility behaviors.

The largest implementation gap is observability and feedback shape, not core simulation math. `RoomStatePayload` currently carries only high-level team fields (`resources`, `income`, `defeated`, `baseIntact`) and does not expose pending queue entries. The client currently does not consume `build:outcome` events, so users do not see terminal rejection causes inline and cannot inspect pending actions by execute tick.

Affordability UX needs one authoritative source of truth in the engine to avoid drift between client-side prediction and server rejection. Keep queue validation in `packages/rts-engine`, add explicit deficit metadata for unaffordable requests, and project pending queue data into state snapshots so timeline/HUD can recover correctly after reconnects.

**Primary recommendation:** Extend engine + shared socket contracts to publish authoritative affordability details and pending queue snapshots, then drive HUD pulse/delta and execute-tick timeline UI entirely from those server-authored payloads.

## Standard Stack

### Core

| Library            | Version         | Purpose                                                                             | Why Standard                                                                               |
| ------------------ | --------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `socket.io`        | 4.8.3 (locked)  | Server-side authoritative event transport and room-scoped broadcasts                | Already used across lifecycle/build flows; provides ordered event delivery and room fanout |
| `socket.io-client` | 4.8.3 (locked)  | Browser event consumption for `state`, `build:queued`, and `build:outcome`          | Existing runtime contract; no transport migration needed                                   |
| `typescript`       | 5.9.3 (locked)  | Shared compile-time contract safety across engine/server/client/tests               | Prevents payload-shape drift while adding queue/economy fields                             |
| `vitest`           | 1.6.1 (locked)  | Unit/integration regression coverage for affordability and queue timeline semantics | Current test runner for package and integration suites                                     |
| `vite`             | 5.4.21 (locked) | Browser runtime bundling for HUD/timeline UI updates                                | Existing web build stack already in place                                                  |

### Supporting

| Library                      | Version         | Purpose                                                                 | When to Use                                                     |
| ---------------------------- | --------------- | ----------------------------------------------------------------------- | --------------------------------------------------------------- |
| In-repo `#rts-engine` APIs   | current         | Deterministic queue + economy authority (`queueBuildEvent`, `tickRoom`) | All affordability/income rule changes stay in package layer     |
| In-repo `socket-contract.ts` | current         | Shared socket payload DTOs                                              | Add pending queue entries and affordability metadata here first |
| `Intl.RelativeTimeFormat`    | ES2022 baseline | Locale-aware relative ETA labels for execute ticks                      | Use for queue timeline countdown/ETA text                       |

### Alternatives Considered

| Instead of                                          | Could Use                                                             | Tradeoff                                                                                                 |
| --------------------------------------------------- | --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| State-projected pending queue in `RoomStatePayload` | Client-only local queue map built from `build:queued`/`build:outcome` | Local-only tracking desyncs on reconnect and missed packets (Socket.IO default is at-most-once delivery) |
| Structured affordability deficit fields             | Parse human-readable `room:error.message` strings                     | Message parsing is brittle and blocks exact "needed vs current" UI requirements                          |
| `Intl.RelativeTimeFormat` for ETA                   | Hand-rolled pluralization/relative time strings                       | Hand-rolled formatting increases i18n/edge-case bugs for little benefit                                  |

**Installation:**

```bash
npm install
```

## Architecture Patterns

### Recommended Project Structure

```text
packages/rts-engine/
├── rts.ts                 # affordability authority, income recomputation, pending queue source
├── socket-contract.ts     # shared DTOs for team economy and pending queue projection
└── rts.test.ts            # affordability/income rule unit tests

apps/server/src/
└── server.ts              # socket boundary validation + room-scoped emissions

apps/web/
├── index.html             # HUD + queue timeline markup near build controls
└── src/client.ts          # state-diff rendering, inline rejection feedback, queue grouping by executeTick

tests/integration/server/
└── server.test.ts         # end-to-end queue affordability + timeline payload assertions
```

### Pattern 1: Engine-Owned Affordability Authority

**What:** Keep affordability and deficit calculation in `packages/rts-engine` and reuse it for pre-queue checks and execution-time revalidation.
**When to use:** Any request that can reject for `insufficient-resources`.
**Example:**

```typescript
// Source: packages/rts-engine/rts.ts
const buildCost = diffCells + template.activationCost;
if (team.resources < buildCost) {
  rejectBuild(room, team, 'insufficient-resources', event.id);
  recordRejectedBuildOutcome(
    buildOutcomes,
    event,
    'insufficient-resources',
    room.tick,
  );
}
```

### Pattern 2: Authoritative Pending Queue Projection

**What:** Publish pending build entries in `RoomStatePayload` from server state each tick.
**When to use:** Rendering queue timeline and reconnect resync.
**Example:**

```typescript
// Source: packages/rts-engine/rts.ts + packages/rts-engine/socket-contract.ts
// Keep server ordering explicit: executeTick asc, then eventId asc.
pendingBuildEvents.sort((a, b) => a.executeTick - b.executeTick || a.id - b.id);
```

### Pattern 3: State-Diff HUD Rendering

**What:** Compute resource/income deltas from consecutive authoritative `state` payloads and render pulse/delta chips.
**When to use:** Every `state` event for the current team.
**Example:**

```typescript
// Source: apps/web/src/client.ts
resourcesEl.textContent = `${team.resources}`;
incomeEl.textContent = `${team.income}/tick`;
// Add per-tick diff against previous team snapshot for pulse + delta chip.
```

### Pattern 4: Relative ETA Formatting

**What:** Format execute tick distance as relative text (`in 3 ticks`) rather than absolute labels.
**When to use:** Queue timeline rows and grouped execute-tick headers.
**Example:**

```typescript
// Source: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/RelativeTimeFormat
const rtf = new Intl.RelativeTimeFormat('en', {
  style: 'short',
  numeric: 'always',
});
const etaLabel = rtf.format(executeTick - currentTick, 'second');
```

### Anti-Patterns to Avoid

- **Client-only affordability logic:** duplicating cost rules in UI without engine parity causes false afford/reject states.
- **Message-string parsing for deficits:** never derive `needed/current/deficit` from free-text errors.
- **Queue timeline from transient events only:** missed packets will orphan items without state-projected queue entries.
- **Unstable queue grouping:** always use `executeTick` then `eventId` ordering for deterministic rendering.

## Don't Hand-Roll

| Problem                                     | Don't Build                                    | Use Instead                                                                       | Why                                                                                 |
| ------------------------------------------- | ---------------------------------------------- | --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Relative ETA labels                         | Custom pluralization and "ago/in" string rules | `Intl.RelativeTimeFormat`                                                         | Standards-based, locale-aware, and already available in target runtime              |
| Event fanout and room segmentation          | Ad hoc channel routing layer                   | Socket.IO rooms (`io.to(room).emit`)                                              | Existing transport already enforces room-scoped delivery patterns                   |
| Queue state reconstruction after disconnect | Browser-only cache of queued IDs               | Authoritative pending queue in `RoomStatePayload`                                 | Socket.IO defaults to at-most-once; state snapshot is the reliable recovery surface |
| Affordability reason schema                 | New ad hoc reason strings in each layer        | Shared `BuildRejectionReason` + structured deficit fields in `socket-contract.ts` | Keeps engine/server/client/tests aligned and testable                               |

**Key insight:** Keep affordability math and queue truth in the engine; keep UI strictly as a projection of authoritative server payloads.

## Common Pitfalls

### Pitfall 1: Affordability Drift Between UI and Server

**What goes wrong:** UI marks a build affordable but server rejects (or vice versa).
**Why it happens:** Cost logic is split across duplicated client/server implementations.
**How to avoid:** Centralize cost/deficit computation in engine helpers and expose structured results through shared contract types.
**Warning signs:** Frequent `insufficient-resources` outcomes immediately after UI showed "affordable".

### Pitfall 2: Timeline Desync After Reconnect

**What goes wrong:** Pending queue UI shows stale items or misses items after temporary disconnect.
**Why it happens:** Timeline is derived only from transient event stream.
**How to avoid:** Render from pending queue data embedded in authoritative `state` payload; treat events as incremental hints only.
**Warning signs:** Timeline differs between two clients in same room or after reconnect.

### Pitfall 3: Missing Exact Deficit Copy

**What goes wrong:** Rejection feedback is generic and fails locked "needed vs current" requirement.
**Why it happens:** `room:error.message`/`build:outcome.reason` lacks numeric deficit fields.
**How to avoid:** Add structured affordability metadata (needed/current/deficit) to rejection payloads and consume it directly in inline UI.
**Warning signs:** UI copy says "insufficient resources" with no numbers.

### Pitfall 4: Income Delta Noise Instead of Signal

**What goes wrong:** HUD pulses constantly or shows noisy chips not tied to actual tick changes.
**Why it happens:** UI re-animates on every state render rather than only on value changes.
**How to avoid:** Diff previous vs current team snapshot by tick; aggregate multiple changes to one chip per tick.
**Warning signs:** Pulse animation triggers even when resources/income are unchanged.

### Pitfall 5: Absolute Tick Labels in Timeline

**What goes wrong:** Timeline shows raw execute tick numbers and violates locked UX decision.
**Why it happens:** Render logic uses `executeTick` directly without relative conversion.
**How to avoid:** Convert `executeTick - currentTick` to relative ETA text and group by execute tick internally.
**Warning signs:** UI labels like `Tick 1432` instead of `in 2 ticks`/`due now`.

## Code Examples

Verified patterns from in-repo and official sources:

### Deterministic Queue Ordering

```typescript
// Source: packages/rts-engine/rts.ts
function compareBuildEvents(a: BuildEvent, b: BuildEvent): number {
  return a.executeTick - b.executeTick || a.id - b.id;
}
```

### Room-Scoped Outcome Broadcast

```typescript
// Source: apps/server/src/server.ts
for (const outcome of outcomes) {
  io.to(roomChannel(room.state.id)).emit('build:outcome', outcome);
}
```

### Dynamic Income Recompute + Resource Accrual

```typescript
// Source: packages/rts-engine/rts.ts
team.income = computedIncome;
team.territoryRadius = DEFAULT_TEAM_TERRITORY_RADIUS + territoryBonus;

if (room.tick > team.lastIncomeTick) {
  const elapsed = room.tick - team.lastIncomeTick;
  team.resources += elapsed * team.income;
  team.lastIncomeTick = room.tick;
}
```

### Relative Time Formatting for ETA Labels

```typescript
// Source: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/RelativeTimeFormat
const rtf = new Intl.RelativeTimeFormat('en', {
  numeric: 'always',
  style: 'short',
});
const ticksUntilExecute = executeTick - currentTick;
const eta =
  ticksUntilExecute <= 0 ? 'due now' : rtf.format(ticksUntilExecute, 'second');
```

## State of the Art

| Old Approach                                                    | Current Approach                                                                 | When Changed   | Impact                                                   |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------- | -------------- | -------------------------------------------------------- |
| HUD shows static resource/income values only                    | HUD shows resource/income with per-tick pulse, delta chip, and cause label       | Phase 4 target | Meets ECON-01 and locked signaling requirements          |
| Build queue feedback ends at `build:queued` message line        | Pending queue timeline grouped by execute tick with relative ETA                 | Phase 4 target | Meets UX-01 and reduces "why didn't it build" confusion  |
| `insufficient-resources` reason without numeric deficit context | Structured rejection deficit fields used for inline "needed vs current" feedback | Phase 4 target | Meets ECON-02 locked copy requirements                   |
| Client ignores `build:outcome` stream                           | Client reconciles pending queue and inline errors from `build:outcome` + `state` | Phase 4 target | Aligns player feedback with authoritative queue outcomes |

**Deprecated/outdated:**

- Treating `build:queued` as sufficient user feedback for delayed actions.
- Using free-text `room:error.message` as machine-readable affordability data.

## Open Questions

1. **Exact pre-submit cost source with current template summary shape**
   - What we know: `StructureTemplateSummary` lacks template cell data; exact cost depends on `diffCells + activationCost`.
   - What's unclear: Whether Phase 4 should add template cell payloads for local computation or a server-side preview response.
   - Recommendation: Pick one canonical preview path in Wave 0 and reuse engine cost helper to avoid drift.

2. **Scope of pending timeline visibility**
   - What we know: Requirement says user can inspect pending builds; current model is one team per player.
   - What's unclear: Whether to show only self team pending entries or all room teams.
   - Recommendation: Default to current player's team queue for Phase 4 and keep room-wide expansion out of scope.

3. **Cause-label taxonomy for income delta chips**
   - What we know: Locked decision requires short cause labels and per-tick aggregation.
   - What's unclear: Exact canonical labels (e.g., `Generator online`, `Structure offline`, `Territory shift`) and server-vs-client derivation.
   - Recommendation: Define a small fixed label set in shared contract (or deterministic client mapping) and test for stability.

## Sources

### Primary (HIGH confidence)

- `/home/alpine/crts-opencode/.planning/phases/04-economy-hud-queue-visibility/04-CONTEXT.md` - locked UX and feedback constraints for this phase.
- `/home/alpine/crts-opencode/.planning/REQUIREMENTS.md` - requirement IDs and exact acceptance wording for ECON-01/02/03 and UX-01.
- `/home/alpine/crts-opencode/packages/rts-engine/rts.ts` - economy recomputation, affordability checks, queue ordering, and payload projection source.
- `/home/alpine/crts-opencode/packages/rts-engine/socket-contract.ts` - current shared socket DTO contract boundaries.
- `/home/alpine/crts-opencode/apps/server/src/server.ts` - `build:queue`, `build:outcome`, and `state` emission behavior.
- `/home/alpine/crts-opencode/apps/web/src/client.ts` - current HUD rendering and missing `build:outcome` consumption.
- `/home/alpine/crts-opencode/apps/web/index.html` - existing HUD/build panel placement and markup constraints.
- `/home/alpine/crts-opencode/package-lock.json` - resolved versions for `socket.io`, `socket.io-client`, `typescript`, `vite`, and `vitest`.
- `https://socket.io/docs/v4/delivery-guarantees/` (last updated Jan 22, 2026) - ordering guarantees and at-most-once caveats.
- `https://socket.io/docs/v4/rooms/` (last updated Jan 22, 2026) - room-scoped broadcast behavior.
- `https://socket.io/docs/v4/emitting-events/` (last updated Jan 22, 2026) - emit/ack semantics and timeout behavior.
- `https://socket.io/docs/v4/typescript/` (last updated Jan 22, 2026) - typed event contracts across server/client.
- `https://socket.io/docs/v4/connection-state-recovery/` (last updated Jan 22, 2026) - reconnection caveats and recovery limitations.
- `https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/RelativeTimeFormat` (last modified Jul 10, 2025) - relative time formatting API.
- `https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/sort` (last modified Jul 20, 2025) - stable sort and comparator behavior.

### Secondary (MEDIUM confidence)

- `/home/alpine/crts-opencode/.planning/research/FEATURES.md` - prior project-level prioritization notes on economy HUD and queue timeline sequencing.

### Tertiary (LOW confidence)

- None.

## Metadata

**Confidence breakdown:**

- Standard stack: HIGH - versions are resolved in lockfile and runtime usage is directly observable in repo.
- Architecture: HIGH - key flow points are visible in engine/server/client source and aligned with locked phase decisions.
- Pitfalls: MEDIUM - pitfalls are strongly evidence-based, but exact UX label/cost-preview contract still needs Phase 4 implementation decisions.

**Research date:** 2026-02-28
**Valid until:** 2026-03-30
