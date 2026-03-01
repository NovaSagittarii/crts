---
phase: 04-economy-hud-queue-visibility
verified: 2026-03-01T00:55:34Z
status: human_needed
score: 10/10 must-haves verified
human_verification:
  - test: 'Live-match HUD pulse/delta readability'
    expected: 'Resources/net income stay legible, pulses are subtle, and one aggregated delta cue appears per tick'
    why_human: 'Visual motion clarity and perceived noise level are UX judgments not fully provable by static checks'
  - test: 'Unaffordable queue feedback comprehension'
    expected: 'Queue action stays disabled and inline text clearly communicates needed/current/deficit values'
    why_human: 'Message clarity is subjective and requires user interpretation'
  - test: 'Mobile layout around build controls'
    expected: 'Economy HUD, queue action, and pending timeline remain usable on narrow viewports without clipping/overlap'
    why_human: 'Responsive usability requires manual viewport interaction'
---

# Phase 4: Economy HUD & Queue Visibility Verification Report

**Phase Goal:** Users can evaluate affordability, expected income, and pending actions while deciding what to build.
**Verified:** 2026-03-01T00:55:34Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| #   | Truth                                                                                                                     | Status     | Evidence                                                                                                                                                                      |
| --- | ------------------------------------------------------------------------------------------------------------------------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Queue affordability is computed in engine authority with explicit `needed/current/deficit` metadata.                      | ✓ VERIFIED | `packages/rts-engine/rts.ts:344`, `packages/rts-engine/rts.ts:1210`, `packages/rts-engine/rts.ts:1218`, `packages/rts-engine/rts.test.ts:293`                                 |
| 2   | Authoritative room state includes deterministic pending queue rows (`executeTick` then `eventId`) with template metadata. | ✓ VERIFIED | `packages/rts-engine/rts.ts:404`, `packages/rts-engine/rts.ts:397`, `packages/rts-engine/rts.ts:1270`, `packages/rts-engine/rts.test.ts:323`                                  |
| 3   | Authoritative room state includes per-team income breakdown fields that change with structure state.                      | ✓ VERIFIED | `packages/rts-engine/rts.ts:779`, `packages/rts-engine/rts.ts:1264`, `packages/rts-engine/rts.test.ts:390`                                                                    |
| 4   | Runtime exposes authoritative `build:preview` affordability responses before queue submission.                            | ✓ VERIFIED | `apps/server/src/server.ts:1393`, `apps/server/src/server.ts:1437`, `apps/server/src/server.ts:1463`, `tests/integration/server/server.test.ts:586`                           |
| 5   | Unaffordable queue attempts return explicit socket-visible reasons with exact deficit numbers.                            | ✓ VERIFIED | `apps/server/src/server.ts:1505`, `apps/server/src/server.ts:1511`, `apps/server/src/server.ts:433`, `tests/integration/server/server.test.ts:637`                            |
| 6   | Room-scoped `state` and `build:outcome` emissions preserve enriched queue/economy metadata from engine payloads.          | ✓ VERIFIED | `apps/server/src/server.ts:374`, `apps/server/src/server.ts:385`, `apps/server/src/server.ts:1570`, `packages/rts-engine/rts.ts:1255`                                         |
| 7   | Players can always see current resources and net income near build controls during active play.                           | ✓ VERIFIED | `apps/web/index.html:904`, `apps/web/index.html:908`, `apps/web/index.html:912`, `apps/web/src/client.ts:676`, `apps/web/src/client.ts:677`                                   |
| 8   | Queue action stays disabled when unaffordable and inline feedback shows exact deficit numbers.                            | ✓ VERIFIED | `apps/web/src/client.ts:505`, `apps/web/src/client.ts:507`, `apps/web/src/client.ts:526`, `apps/web/src/client.ts:1894`, `apps/web/src/client.ts:1609`                        |
| 9   | Income/resource changes trigger pulse cues and one aggregated per-tick delta chip with short causes.                      | ✓ VERIFIED | `apps/web/src/client.ts:699`, `apps/web/src/client.ts:703`, `apps/web/src/client.ts:729`, `apps/web/src/economy-view-model.ts:123`, `tests/web/economy-view-model.test.ts:66` |
| 10  | Pending build timeline shows pending-only items grouped by execute tick with template + relative ETA context.             | ✓ VERIFIED | `apps/web/src/client.ts:568`, `apps/web/src/client.ts:576`, `apps/web/src/client.ts:587`, `apps/web/src/client.ts:600`, `apps/web/src/economy-view-model.ts:74`               |

**Score:** 10/10 truths verified

### Required Artifacts

| Artifact                                  | Expected                                                       | Status     | Details                                                                                                                                                                                                                             |
| ----------------------------------------- | -------------------------------------------------------------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/rts-engine/rts.ts`              | Engine affordability, pending projection, income breakdown     | ✓ VERIFIED | Contains affordability evaluator + rejection metadata + projected pending rows + income breakdown; consumed by server runtime (`packages/rts-engine/rts.ts:344`, `packages/rts-engine/rts.ts:1255`, `apps/server/src/server.ts:39`) |
| `packages/rts-engine/socket-contract.ts`  | Shared DTOs for preview/deficit/pending/income payloads        | ✓ VERIFIED | Exports preview and deficit-capable contracts used by runtime/client (`packages/rts-engine/socket-contract.ts:26`, `packages/rts-engine/socket-contract.ts:55`, `packages/rts-engine/socket-contract.ts:205`)                       |
| `packages/rts-engine/rts.test.ts`         | Regression coverage for deficits, ordering, income behavior    | ✓ VERIFIED | Includes targeted affordability/pending/income tests and passed (`packages/rts-engine/rts.test.ts:293`, `packages/rts-engine/rts.test.ts:323`, `packages/rts-engine/rts.test.ts:390`)                                               |
| `apps/server/src/server.ts`               | Preview handler, deficit mapping, state/outcome emission       | ✓ VERIFIED | `build:preview` probe, structured queue rejection, room-scoped state/outcome wiring (`apps/server/src/server.ts:1393`, `apps/server/src/server.ts:1505`, `apps/server/src/server.ts:374`)                                           |
| `tests/integration/server/server.test.ts` | Runtime contract coverage for preview/rejection/pending state  | ✓ VERIFIED | Contains and passes preview, unaffordable rejection, and pending projection tests (`tests/integration/server/server.test.ts:586`, `tests/integration/server/server.test.ts:637`, `tests/integration/server/server.test.ts:732`)     |
| `apps/server/AGENTS.md`                   | Updated server contract docs for Phase 4 payloads              | ✓ VERIFIED | Documents preview + deficit fields + pending/income state expectations (`apps/server/AGENTS.md:24`, `apps/server/AGENTS.md:39`, `apps/server/AGENTS.md:48`)                                                                         |
| `apps/web/index.html`                     | HUD, affordability feedback, queue action, timeline containers | ✓ VERIFIED | Defines required HUD and queue/timeline DOM anchors consumed by client (`apps/web/index.html:908`, `apps/web/index.html:940`, `apps/web/index.html:948`)                                                                            |
| `apps/web/src/economy-view-model.ts`      | Deterministic grouping/ETA/delta helper layer                  | ✓ VERIFIED | Implements pure grouping, relative ETA, and delta aggregation consumed by client/tests (`apps/web/src/economy-view-model.ts:62`, `apps/web/src/economy-view-model.ts:74`, `apps/web/src/economy-view-model.ts:123`)                 |
| `tests/web/economy-view-model.test.ts`    | Tests for ordering/ETA/aggregation rules                       | ✓ VERIFIED | Locks deterministic grouping and one-cue-per-tick aggregation behavior (`tests/web/economy-view-model.test.ts:13`, `tests/web/economy-view-model.test.ts:58`, `tests/web/economy-view-model.test.ts:66`)                            |
| `apps/web/src/client.ts`                  | Runtime wiring for HUD gating, deficits, timeline rendering    | ✓ VERIFIED | Uses authoritative `state`/`build:preview`/`room:error`/`build:outcome` to render and gate queue action (`apps/web/src/client.ts:531`, `apps/web/src/client.ts:1606`, `apps/web/src/client.ts:1717`)                                |
| `apps/web/AGENTS.md`                      | Updated client event-usage contract docs                       | ✓ VERIFIED | Documents Phase 4 authoritative economy/queue usage expectations (`apps/web/AGENTS.md:54`, `apps/web/AGENTS.md:56`, `apps/web/AGENTS.md:59`)                                                                                        |

### Key Link Verification

| From                         | To                                        | Via                                                                  | Status  | Details                                                                                                                                                                                                                                           |
| ---------------------------- | ----------------------------------------- | -------------------------------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/rts-engine/rts.ts` | `packages/rts-engine/socket-contract.ts`  | Affordability/pending/income DTO alignment                           | ✓ WIRED | Contract aliases are imported from engine types and expose deficit/pending/income fields (`packages/rts-engine/socket-contract.ts:1`, `packages/rts-engine/socket-contract.ts:26`, `packages/rts-engine/socket-contract.ts:31`)                   |
| `packages/rts-engine/rts.ts` | `packages/rts-engine/rts.test.ts`         | Tests lock ordering and deficit math                                 | ✓ WIRED | Tests directly call queue/payload APIs and assert deficit + sort contracts (`packages/rts-engine/rts.test.ts:303`, `packages/rts-engine/rts.test.ts:355`)                                                                                         |
| `apps/server/src/server.ts`  | `packages/rts-engine/rts.ts`              | Server preview/queue uses engine authority                           | ✓ WIRED | Runtime probes/queues through `queueBuildEvent` and emits engine-derived fields (`apps/server/src/server.ts:39`, `apps/server/src/server.ts:1018`, `apps/server/src/server.ts:1494`)                                                              |
| `apps/server/src/server.ts`  | `tests/integration/server/server.test.ts` | Integration asserts preview/rejection/pending contracts              | ✓ WIRED | Integration suite validates emitted preview/deficit/pending payload behavior (`tests/integration/server/server.test.ts:616`, `tests/integration/server/server.test.ts:709`, `tests/integration/server/server.test.ts:802`)                        |
| `apps/web/src/client.ts`     | `apps/web/src/economy-view-model.ts`      | Client delegates grouping/ETA/delta helpers                          | ✓ WIRED | Client imports and calls helper functions for timeline and delta cues (`apps/web/src/client.ts:27`, `apps/web/src/client.ts:576`, `apps/web/src/client.ts:729`)                                                                                   |
| `apps/web/src/client.ts`     | `apps/web/index.html`                     | HUD + queue + pending elements populated from authoritative payloads | ✓ WIRED | Client binds required IDs and updates them from `state`/preview/rejection events (`apps/web/src/client.ts:113`, `apps/web/src/client.ts:660`, `apps/web/src/client.ts:1717`)                                                                      |
| `apps/web/src/client.ts`     | `tests/web/economy-view-model.test.ts`    | Deterministic helper rules used by UI are test-locked                | ✓ WIRED | Test suite covers executeTick/eventId ordering, ETA strings, and cause aggregation consumed by client rendering (`tests/web/economy-view-model.test.ts:13`, `tests/web/economy-view-model.test.ts:55`, `tests/web/economy-view-model.test.ts:81`) |

### Requirements Coverage

| Requirement | Source Plan                                       | Description                                                                            | Status      | Evidence                                                                                                                                                                                                                                                                             |
| ----------- | ------------------------------------------------- | -------------------------------------------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `ECON-01`   | `04-03-PLAN.md`                                   | User can see current resources and per-tick income in the match HUD.                   | ✓ SATISFIED | HUD markup + client state wiring update resources/income near build controls (`apps/web/index.html:904`, `apps/web/src/client.ts:676`, `apps/web/src/client.ts:1244`)                                                                                                                |
| `ECON-02`   | `04-01-PLAN.md`, `04-02-PLAN.md`, `04-03-PLAN.md` | User can only queue affordable builds; unaffordable requests are rejected with reason. | ✓ SATISFIED | Engine deficit metadata + server rejection payload + client gating/inline copy + integration assertions (`packages/rts-engine/rts.ts:1212`, `apps/server/src/server.ts:1511`, `apps/web/src/client.ts:505`, `tests/integration/server/server.test.ts:709`)                           |
| `ECON-03`   | `04-01-PLAN.md`, `04-02-PLAN.md`, `04-03-PLAN.md` | Resource income updates dynamically based on owned structures/territory state.         | ✓ SATISFIED | Engine recomputes income breakdown per tick, payload exposes it, client delta cues react to changes, tests verify breakdown transitions (`packages/rts-engine/rts.ts:759`, `packages/rts-engine/rts.ts:1264`, `apps/web/src/client.ts:713`, `packages/rts-engine/rts.test.ts:426`)   |
| `UX-01`     | `04-01-PLAN.md`, `04-02-PLAN.md`, `04-03-PLAN.md` | User can inspect pending builds in execute-tick timeline order.                        | ✓ SATISFIED | Engine pending projection sorted, server emits room `state`, client groups/render timeline with relative ETA, tests verify ordering (`packages/rts-engine/rts.ts:404`, `apps/server/src/server.ts:374`, `apps/web/src/client.ts:576`, `tests/integration/server/server.test.ts:802`) |

Plan requirement IDs declared: `ECON-01`, `ECON-02`, `ECON-03`, `UX-01`.
Phase 4 requirement IDs in `REQUIREMENTS.md`: `ECON-01`, `ECON-02`, `ECON-03`, `UX-01`.
Orphaned requirement IDs: none.

### Anti-Patterns Found

| File                        | Line | Pattern                         | Severity | Impact                                                           |
| --------------------------- | ---- | ------------------------------- | -------- | ---------------------------------------------------------------- |
| `apps/server/src/server.ts` | 1649 | Runtime bootstrap `console.log` | ℹ️ Info  | Expected startup log; not an implementation stub or goal blocker |
| `apps/web/index.html`       | 973  | `placeholder` input attributes  | ℹ️ Info  | Standard form UX copy; not a placeholder implementation          |

No TODO/FIXME/placeholder stubs or empty handlers were found in phase artifacts (`rg` scan).

### Human Verification Required

### 1. Live-match HUD pulse/delta readability

**Test:** Start an active match, place builds that change income/resources, and observe HUD metrics over several ticks.
**Expected:** Resources and net income update near build controls; pulse cues are subtle; one aggregated delta chip appears per tick with short cause labels.
**Why human:** Animation feel/readability cannot be conclusively judged from static code or unit assertions.

### 2. Unaffordable queue feedback comprehension

**Test:** In Template Queue mode, select an unaffordable placement and attempt to queue.
**Expected:** Queue button remains disabled and inline text clearly communicates `needed`, `current`, and `deficit`; rejection copy stays understandable.
**Why human:** Clarity/comprehension of user-facing copy is a UX judgment.

### 3. Mobile build-panel usability

**Test:** Open the client on a narrow viewport and exercise build selection, queue action, and pending timeline scrolling.
**Expected:** HUD, queue controls, and pending timeline stay visible and usable without clipping/overlap.
**Why human:** Responsive interaction quality requires manual viewport testing.

### Gaps Summary

No implementation gaps were found in code, wiring, or automated tests for phase must-haves. Status is `human_needed` only because final UX/visual/responsive checks require manual validation.

Automated verification executed:

- `npx vitest run packages/rts-engine/rts.test.ts tests/integration/server/server.test.ts tests/web/economy-view-model.test.ts` → passed (30/30 tests).

---

_Verified: 2026-03-01T00:55:34Z_
_Verifier: OpenCode (gsd-verifier)_
