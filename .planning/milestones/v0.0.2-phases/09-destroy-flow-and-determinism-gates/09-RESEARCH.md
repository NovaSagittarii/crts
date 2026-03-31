# Phase 9: Destroy Flow and Determinism Gates - Research

**Researched:** 2026-03-02
**Domain:** Authoritative structure destroy actions with two-client and reconnect determinism
**Confidence:** HIGH

<user_constraints>

## User Constraints (from CONTEXT.md)

### Locked Decisions

#### Destroy interaction flow

- Destroy control appears in the action bar only when an owned structure is selected.
- Interaction sequence is select owned structure first, then activate destroy.
- Destroy flow is single-action: after a successful destroy, exit destroy-ready state.
- While a destroy is pending, player may target a different structure; repeated same-target requests are idempotent and ignored by the server.

#### Safety and confirmation behavior

- Default destroy behavior is immediate on click.
- Destroy controls are hidden for non-owned structures.
- Pending destroy has an explicit visual pending state until authoritative outcome arrives.
- Base structure requires an inline confirm modal before destroy.
- Confirmation requirement should be implemented as a structure-level property so future structure types can opt into the same behavior.

#### Outcome and rejection feedback

- On accepted destroy, acting player sees subtle success feedback plus authoritative board update.
- Opponent receives no explicit destroy notice; they infer changes from authoritative board and build-eligibility updates.
- Rejected destroy attempts return deterministic reasons: wrong owner, invalid target, invalid lifecycle state.
- Acting player sees rejection feedback both inline near destroy control and as a toast.

#### Reconnect and parity expectations

- Reconnecting clients snap directly to authoritative current state; no replay requirement.
- Destroy requests follow server queue semantics like build actions.
- Determinism acceptance is based on identical authoritative outcomes and resulting structure and build-eligibility state across both clients.
- Show a small `Reconnected, state synced` notice after successful resync.

### OpenCode's Discretion

- Exact copy style for pending, rejection, and reconnect notices.
- Exact visual treatment and timing for pending indicators and toasts.
- Internal queue and projection model details, as long as determinism and locked user behavior are preserved.

### Deferred Ideas (OUT OF SCOPE)

- Bulk destroy and undo timelines.
- Non-authoritative client prediction for destroy outcomes.
- New gameplay systems unrelated to destroy or determinism gates.

</user_constraints>

<phase_requirements>

## Phase Requirements

| ID        | Description                                                                                                                                  | Research Support                                                                                                                                                                                                                              |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| STRUCT-02 | Player can destroy an owned structure from in-match controls and receive an authoritative destroy outcome.                                   | Add destroy queue payloads and deterministic validation in `#rts-engine`, then expose server runtime handlers and web controls that select owned structures, enqueue destroy actions, and render authoritative pending and terminal outcomes. |
| QUAL-04   | Player gets deterministic outcomes for v0.0.2 structure/build/destroy behaviors across two-client integration scenarios and reconnect cases. | Add deterministic two-client and reconnect integration suites that assert equal destroy and build outcomes, stable rejection taxonomy, and convergent authoritative state after reconnect without event replay dependencies.                  |

</phase_requirements>

## Summary

Phase 9 is an authority-and-parity phase centered on destroy actions. The codebase already has deterministic build queue behavior and deterministic structure integrity destruction, but it has no player-driven destroy command path. Server runtime only accepts `build:*` and `cell:update` gameplay mutations, and the current shared socket contract has no destroy payload surfaces.

This means STRUCT-02 and QUAL-04 cannot be met by UI work alone. The phase needs one canonical destroy queue flow that mirrors the existing build queue pattern: strict payload validation, deterministic acceptance/rejection reasons, one terminal outcome per accepted event, and state-first reconnect convergence. The safest implementation order remains engine/contract first, runtime integration second, and client controls last.

**Primary recommendation:** Introduce deterministic destroy queue primitives in `packages/rts-engine` (with idempotent same-target behavior and lifecycle reason taxonomy), then wire Socket.IO runtime and integration determinism gates before adding web destroy controls.

## Standard Stack

### Core

| Library                          | Version    | Purpose                                                                 | Why Standard                                                                                       |
| -------------------------------- | ---------- | ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `#rts-engine`                    | repo-local | Authoritative room/team/structure queue and tick logic                  | Destroy semantics must be deterministic and live in shared simulation logic, not runtime branches. |
| `socket.io` + `socket.io-client` | 4.8.x      | Runtime mutation transport and two-client/reconnect integration harness | Existing event lifecycle and reconnect behavior is already proven in current integration suites.   |
| `typescript`                     | 5.x        | Typed destroy payload contracts and reason taxonomy                     | Prevents runtime/client drift when adding new destroy events and state projection fields.          |
| `vitest`                         | 1.x        | Deterministic unit and integration verification                         | Existing project standard for queue/outcome determinism and reconnect-safe event assertions.       |

### Supporting

| Library/Module                    | Version    | Purpose                                                            | When to Use                                                                                                |
| --------------------------------- | ---------- | ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| In-repo socket contract types     | repo-local | Single source of truth for server/web/test payloads                | Add destroy queue request, queued ack, and terminal outcome payload types here first.                      |
| Existing reconnect session system | repo-local | Session hold/rejoin and authoritative membership/state rebroadcast | Use current room `state` + membership rebroadcast loop for reconnect resync instead of event replay logic. |

## Architecture Patterns

### Pattern 1: Queue-Modeled Destroy Mutation

**What:** Destroy uses a queued mutation model with deterministic ordering and one terminal authoritative outcome per accepted request.
**When to use:** Any player-issued structure destroy action.
**Why:** Keeps mutation semantics aligned with existing build queue behavior and supports reconnect-safe eventual consistency.

### Pattern 2: Deterministic Reason Taxonomy at Engine Boundary

**What:** Validation reason codes are produced in engine and forwarded through runtime unchanged.
**When to use:** Wrong owner, invalid target, invalid lifecycle state, and other deterministic destroy rejection paths.
**Why:** Prevents server/client string-mapping drift and keeps integration assertions stable.

### Pattern 3: Authoritative State Projection for Reconnect

**What:** Reconnected clients derive current truth from authoritative `state` snapshots and queued action projections.
**When to use:** Recovering from disconnect during pending destroy or post-destroy board convergence.
**Why:** Socket event delivery is ordered but not guaranteed replay-by-default across disconnect windows.

### Anti-Patterns to Avoid

- Client-local destroy simulation or optimistic authoritative assumptions.
- Separate destroy validation logic in runtime and engine.
- Opponent-only side channels for destroy notifications outside authoritative state and outcome payloads.
- Time-based sleeps in tests instead of bounded event/state wait helpers.

## Dont Hand-Roll

| Problem                | Dont Build                                     | Use Instead                                                          | Why                                                                |
| ---------------------- | ---------------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Destroy reason mapping | New ad-hoc runtime string translation branches | Typed destroy rejection reasons from engine through socket contracts | Keeps reason taxonomy deterministic and testable.                  |
| Reconnect convergence  | Client replay or event-history reconstruction  | Authoritative `state` payload snapshots and queue projections        | Existing server loop already rebroadcasts authoritative snapshots. |
| Queue ordering         | Unordered arrays with insertion-side effects   | Existing deterministic event comparators (`executeTick`, `eventId`)  | Preserves deterministic equal-run outcomes.                        |

## Common Pitfalls

### Pitfall 1: Duplicate destroy requests create multiple terminal outcomes

**What goes wrong:** Repeated same-target clicks enqueue multiple destroy actions.
**How to avoid:** Treat same-team same-target pending requests as idempotent and return one canonical queued state.

### Pitfall 2: Wrong-owner checks happen only in client

**What goes wrong:** Client hides controls but runtime still allows unauthorized destroy requests.
**How to avoid:** Keep ownership checks authoritative in engine queue validation and runtime gates.

### Pitfall 3: Reconnect tests assert event delivery instead of final state

**What goes wrong:** Tests pass despite state divergence after reconnect.
**How to avoid:** Assert convergent `state` payload structure/build eligibility snapshots and terminal outcomes across both clients.

### Pitfall 4: Base confirmation is hardcoded in UI only

**What goes wrong:** Future structure types cannot opt into confirmation semantics.
**How to avoid:** Add a structure-level `requiresDestroyConfirm` property in authoritative projection and use it in UI flow.

### Pitfall 5: Destroy path bypasses queue order relative to builds

**What goes wrong:** Same-tick build/destroy interactions diverge by runtime timing.
**How to avoid:** Keep destroy execution in deterministic tick processing with explicit ordering rules and unit tests.

## Validation Architecture

### Unit Layer

- Extend `packages/rts-engine/rts.test.ts` with deterministic destroy acceptance/rejection, idempotency, and build-zone update assertions.
- Add equal-run replay tests that execute identical build and destroy sequences and compare outcomes/state snapshots.

### Integration Layer

- Extend `tests/integration/server/server.test.ts` for two-client destroy queued/outcome parity and deterministic rejection reasons.
- Add a focused reconnect determinism case (new or existing integration file) asserting post-reconnect state convergence after pending/processed destroy actions.
- Extend `tests/integration/server/quality-gate-loop.test.ts` with a QUAL-04-tagged scenario that includes build plus destroy parity checks.

### Web Layer

- Add view-model tests for destroy selection and confirmation state transitions.
- Keep `npm run build` as final contract/UI compile gate.

## Open Questions

1. **Destroy payload target key:** structure key vs anchor coordinates.
   - Recommendation: use structure key from authoritative state projection, with server-side fallback validation against lifecycle/ownership.

2. **Destroy vs build ordering for same execute tick:**
   - Recommendation: define one deterministic comparator that includes action type ordering and cover with unit tests.

3. **Core destroy outcome treatment before defeat propagation:**
   - Recommendation: preserve existing defeat pipeline and emit destroy outcome with stable reason fields when core action is rejected or confirmed.

## Sources

### Primary (HIGH confidence)

- `.planning/ROADMAP.md` - Phase 9 goal, requirement IDs, and success criteria.
- `.planning/REQUIREMENTS.md` - STRUCT-02 and QUAL-04 requirement definitions.
- `.planning/STATE.md` - architecture constraints and pending phase focus.
- `.planning/phases/09-destroy-flow-and-determinism-gates/09-CONTEXT.md` - locked product decisions.
- `packages/rts-engine/rts.ts` - deterministic queue and tick baseline, structure lifecycle logic.
- `packages/rts-engine/socket-contract.ts` - current transport contract boundaries and missing destroy events.
- `apps/server/src/server.ts` - current runtime mutation handlers and reconnect rebroadcast loop.
- `apps/web/src/client.ts` - current build controls, reconnect UI, and mutation gating behavior.
- `tests/integration/server/server.test.ts` - two-client queue/outcome parity patterns.
- `tests/integration/server/lobby-reconnect.test.ts` - reconnect/session-priority patterns.

### Secondary (MEDIUM confidence)

- `https://socket.io/docs/v4/delivery-guarantees/` - ordering and at-most-once delivery semantics.

## Metadata

**Confidence breakdown:**

- Stack: HIGH - aligns with existing project dependencies and active usage.
- Architecture: HIGH - directly extends current queue and authoritative state patterns.
- Pitfalls: HIGH - each risk maps to currently observed code-path boundaries.

**Research date:** 2026-03-02
**Valid until:** 2026-04-01
