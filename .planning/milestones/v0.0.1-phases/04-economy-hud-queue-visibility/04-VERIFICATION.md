---
phase: 04-economy-hud-queue-visibility
verified: 2026-03-01T08:33:24Z
status: human_needed
score: 11/11 must-haves verified
re_verification:
  previous_status: gaps_found
  previous_score: 10/11
  gaps_closed:
    - 'Browser bootstrap now requires executable client assets and reaches room membership handshake in automated smoke coverage.'
  gaps_remaining: []
  regressions: []
human_verification:
  - test: 'Clean-start browser bootstrap and room entry'
    expected: 'From a fresh clone, `npm start` serves executable assets, lifecycle leaves waiting state, and joining reaches interactive HUD/queue controls.'
    why_human: 'Requires real browser startup flow and end-user interaction confirmation.'
  - test: 'Connection-loss messaging visibility'
    expected: 'When server connectivity drops and recovers, `#status`, `#lifecycle-status-line`, and inline message/toast surfaces show clear reconnect progress and recovery.'
    why_human: 'Error-message clarity and timing are UX qualities not fully verifiable via static inspection.'
  - test: 'Economy cue readability during active play'
    expected: 'Resource/income pulse cues and the delta chip are noticeable without overwhelming gameplay context, and timeline grouping remains easy to parse.'
    why_human: 'Visual intensity/readability and interaction feel require human perception.'
---

# Phase 4: Economy HUD & Queue Visibility Verification Report

**Phase Goal:** Users can evaluate affordability, expected income, and pending actions while deciding what to build.
**Verified:** 2026-03-01T08:33:24Z
**Status:** human_needed
**Re-verification:** Yes — after gap closure

## Goal Achievement

### Observable Truths

| #   | Truth                                                                                                                                              | Status     | Evidence                                                                                                                                                                                                                                                                                 |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Queue affordability is computed in engine authority with explicit `needed/current/deficit` metadata.                                               | ✓ VERIFIED | `packages/rts-engine/rts.ts:344`, `packages/rts-engine/rts.ts:1210`, `packages/rts-engine/rts.ts:1221`, `packages/rts-engine/rts.test.ts:293`                                                                                                                                            |
| 2   | Authoritative room state includes deterministic pending queue rows (`executeTick` then `eventId`) with template metadata.                          | ✓ VERIFIED | `packages/rts-engine/rts.ts:397`, `packages/rts-engine/rts.ts:404`, `packages/rts-engine/rts.ts:1270`, `packages/rts-engine/rts.test.ts:323`                                                                                                                                             |
| 3   | Authoritative room state includes per-team income breakdown data that changes with structure state.                                                | ✓ VERIFIED | `packages/rts-engine/rts.ts:779`, `packages/rts-engine/rts.ts:1264`, `packages/rts-engine/rts.test.ts:390`, `packages/rts-engine/rts.test.ts:426`                                                                                                                                        |
| 4   | Runtime exposes authoritative `build:preview` affordability responses before queue submission.                                                     | ✓ VERIFIED | `apps/server/src/server.ts:1406`, `apps/server/src/server.ts:1450`, `apps/server/src/server.ts:1476`, `tests/integration/server/server.test.ts:610`                                                                                                                                      |
| 5   | Unaffordable queue attempts return explicit reasons with exact deficit numbers at socket boundary.                                                 | ✓ VERIFIED | `apps/server/src/server.ts:1518`, `apps/server/src/server.ts:1524`, `apps/server/src/server.ts:1525`, `tests/integration/server/server.test.ts:637`, `tests/integration/server/server.test.ts:709`                                                                                       |
| 6   | Room-scoped `state` and `build:outcome` emissions preserve enriched queue/economy metadata.                                                        | ✓ VERIFIED | `apps/server/src/server.ts:386`, `apps/server/src/server.ts:398`, `apps/server/src/server.ts:1581`, `apps/server/src/server.ts:1608`, `tests/integration/server/server.test.ts:788`                                                                                                      |
| 7   | Players can see resources and net income near build controls during play.                                                                          | ✓ VERIFIED | `apps/web/index.html:904`, `apps/web/index.html:912`, `apps/web/src/client.ts:740`, `apps/web/src/client.ts:1275`                                                                                                                                                                        |
| 8   | Queue action stays disabled when unaffordable and inline feedback shows exact deficits.                                                            | ✓ VERIFIED | `apps/web/src/client.ts:539`, `apps/web/src/client.ts:569`, `apps/web/src/client.ts:590`, `apps/web/src/client.ts:1841`                                                                                                                                                                  |
| 9   | Income/resource changes trigger pulse cues and one aggregated delta chip per tick.                                                                 | ✓ VERIFIED | `apps/web/src/client.ts:764`, `apps/web/src/client.ts:767`, `apps/web/src/client.ts:793`, `apps/web/src/economy-view-model.ts:123`, `tests/web/economy-view-model.test.ts:75`                                                                                                            |
| 10  | Pending timeline renders pending-only items grouped by execute tick with relative ETA labels.                                                      | ✓ VERIFIED | `apps/web/src/client.ts:626`, `apps/web/src/client.ts:640`, `apps/web/src/client.ts:664`, `apps/web/src/economy-view-model.ts:74`, `tests/web/economy-view-model.test.ts:49`                                                                                                             |
| 11  | Browser runtime can load executable client assets from server startup path and reach `room:joined` + `room:membership` before Phase 4 interaction. | ✓ VERIFIED | `apps/server/src/server.ts:82`, `apps/server/src/server.ts:86`, `apps/server/src/server.ts:1659`, `package.json:20`, `tests/integration/server/bootstrap-smoke.test.ts:57`, `tests/integration/server/bootstrap-smoke.test.ts:66`, `tests/integration/server/bootstrap-smoke.test.ts:77` |

**Score:** 11/11 truths verified

### Required Artifacts

| Artifact                                           | Expected                                                                     | Status     | Details                                                                                                                                                                                                                                            |
| -------------------------------------------------- | ---------------------------------------------------------------------------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/rts-engine/rts.ts`                       | Engine authority for affordability, pending projection, and income breakdown | ✓ VERIFIED | Exists; substantive logic at `packages/rts-engine/rts.ts:344`, `packages/rts-engine/rts.ts:404`, `packages/rts-engine/rts.ts:779`; wired to runtime via `queueBuildEvent` usage in `apps/server/src/server.ts:1507`.                               |
| `packages/rts-engine/rts.test.ts`                  | Regression coverage for affordability/pending/income invariants              | ✓ VERIFIED | Exists; substantive tests at `packages/rts-engine/rts.test.ts:293`, `packages/rts-engine/rts.test.ts:323`, `packages/rts-engine/rts.test.ts:390`; exercised in verification run (15 tests passed overall).                                         |
| `apps/server/src/server.ts`                        | Socket runtime preview/rejection/membership and static bootstrap guardrails  | ✓ VERIFIED | Exists; substantive handlers at `apps/server/src/server.ts:1406`, `apps/server/src/server.ts:1518`, static guard at `apps/server/src/server.ts:82`; wired to start flow (`package.json:20`) and smoke/integration tests.                           |
| `tests/integration/server/server.test.ts`          | Runtime contract coverage for preview/rejection/pending state                | ✓ VERIFIED | Exists; substantive assertions for preview and deficit metadata (`tests/integration/server/server.test.ts:610`, `tests/integration/server/server.test.ts:637`) and pending queue state (`tests/integration/server/server.test.ts:788`).            |
| `apps/web/index.html`                              | HUD/queue/timeline/status DOM anchors near build controls                    | ✓ VERIFIED | Exists; substantive containers at `apps/web/index.html:904`, `apps/web/index.html:935`, `apps/web/index.html:948` and lifecycle/status anchors at `apps/web/index.html:819`, `apps/web/index.html:830`, `apps/web/index.html:1026`.                |
| `apps/web/src/client.ts`                           | Client wiring for HUD, affordability gating, timeline, and connection errors | ✓ VERIFIED | Exists; substantive queue/timeline/economy wiring at `apps/web/src/client.ts:539`, `apps/web/src/client.ts:626`, `apps/web/src/client.ts:724`; connect/bootstrap error surfaces at `apps/web/src/client.ts:1598`, `apps/web/src/client.ts:1632`.   |
| `apps/web/src/economy-view-model.ts`               | Deterministic helper logic for timeline ETA/grouping and delta aggregation   | ✓ VERIFIED | Exists; substantive helpers at `apps/web/src/economy-view-model.ts:62`, `apps/web/src/economy-view-model.ts:74`, `apps/web/src/economy-view-model.ts:123`; wired from client imports at `apps/web/src/client.ts:27`.                               |
| `tests/web/economy-view-model.test.ts`             | Unit coverage for helper deterministic behavior                              | ✓ VERIFIED | Exists; substantive helper tests at `tests/web/economy-view-model.test.ts:49`, `tests/web/economy-view-model.test.ts:59`, `tests/web/economy-view-model.test.ts:75`; passed in verification run.                                                   |
| `package.json`                                     | Start flow guarantees executable client assets before server launch          | ✓ VERIFIED | Exists; substantive start script `npm run build && npm run build:server && node ...` at `package.json:20`; wired to strict asset mode in `apps/server/src/server.ts:1659`.                                                                         |
| `tests/integration/server/bootstrap-smoke.test.ts` | Smoke coverage for HTML -> module executability -> membership handshake      | ✓ VERIFIED | Exists; substantive module/content-type assertions at `tests/integration/server/bootstrap-smoke.test.ts:57`, `tests/integration/server/bootstrap-smoke.test.ts:63`; handshake assertions at `tests/integration/server/bootstrap-smoke.test.ts:77`. |

### Key Link Verification

| From                        | To                                                 | Via                                                                                               | Status  | Details                                                                                                                                                                                                                                            |
| --------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `package.json`              | `apps/server/src/server.ts`                        | `start` builds client/server before running strict CLI server mode                                | ✓ WIRED | `package.json:20` builds artifacts, then CLI path enforces strict assets via `createServer({ ..., clientAssetsMode: 'strict' })` at `apps/server/src/server.ts:1659`.                                                                              |
| `apps/server/src/server.ts` | `tests/integration/server/bootstrap-smoke.test.ts` | Smoke test verifies served module is JS and reaches membership events                             | ✓ WIRED | Guardrail code at `apps/server/src/server.ts:82` + smoke assertions at `tests/integration/server/bootstrap-smoke.test.ts:57`, `tests/integration/server/bootstrap-smoke.test.ts:66`, `tests/integration/server/bootstrap-smoke.test.ts:81`.        |
| `apps/server/src/server.ts` | `apps/web/src/client.ts`                           | Socket membership contract (`room:joined`, `room:membership`)                                     | ✓ WIRED | Server emits in `apps/server/src/server.ts:621` and `apps/server/src/server.ts:632`; client listens at `apps/web/src/client.ts:1646` and `apps/web/src/client.ts:1770`.                                                                            |
| `apps/server/src/server.ts` | `packages/rts-engine/rts.ts`                       | Preview and queue handlers delegate to engine authority (`runQueueBuildProbe`, `queueBuildEvent`) | ✓ WIRED | Runtime calls engine helpers at `apps/server/src/server.ts:1450` and `apps/server/src/server.ts:1507`; no duplicate cost simulation in runtime layer.                                                                                              |
| `apps/web/src/client.ts`    | `apps/web/src/economy-view-model.ts`               | Client rendering delegates grouping/ETA/delta aggregation to pure helpers                         | ✓ WIRED | Imported helpers at `apps/web/src/client.ts:27`; called at `apps/web/src/client.ts:640`, `apps/web/src/client.ts:664`, `apps/web/src/client.ts:793`.                                                                                               |
| `apps/web/src/client.ts`    | `apps/web/index.html`                              | DOM ids for status/lifecycle/message and HUD/queue/timeline are updated by client code            | ✓ WIRED | Required DOM ids in `apps/web/index.html:819`, `apps/web/index.html:830`, `apps/web/index.html:1026`, `apps/web/index.html:940`; referenced in client at `apps/web/src/client.ts:106`, `apps/web/src/client.ts:135`, `apps/web/src/client.ts:282`. |

### Requirements Coverage

| Requirement | Source Plan                                                        | Description                                                                            | Status      | Evidence                                                                                                                                                                                                                                                                 |
| ----------- | ------------------------------------------------------------------ | -------------------------------------------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `ECON-01`   | `04-03-PLAN.md`, `04-04-PLAN.md`                                   | User can see current resources and per-tick income in the match HUD.                   | ✓ SATISFIED | HUD/readouts in `apps/web/index.html:904`; runtime updates in `apps/web/src/client.ts:740` and `apps/web/src/client.ts:1275`; bootstrap path unblocked by strict assets in `apps/server/src/server.ts:82` and `package.json:20`.                                         |
| `ECON-02`   | `04-01-PLAN.md`, `04-02-PLAN.md`, `04-03-PLAN.md`, `04-04-PLAN.md` | User can only queue affordable builds; unaffordable requests are rejected with reason. | ✓ SATISFIED | Engine deficits in `packages/rts-engine/rts.ts:344`; server rejection metadata in `apps/server/src/server.ts:1518`; client queue gating in `apps/web/src/client.ts:569`; integration coverage in `tests/integration/server/server.test.ts:637`.                          |
| `ECON-03`   | `04-01-PLAN.md`, `04-02-PLAN.md`, `04-03-PLAN.md`, `04-04-PLAN.md` | Resource income updates dynamically based on owned structures/territory state.         | ✓ SATISFIED | Income breakdown recalculation in `packages/rts-engine/rts.ts:779`; payload projection in `packages/rts-engine/rts.ts:1264`; HUD updates/pulse in `apps/web/src/client.ts:746` and `apps/web/src/client.ts:764`; unit coverage in `packages/rts-engine/rts.test.ts:390`. |
| `UX-01`     | `04-01-PLAN.md`, `04-02-PLAN.md`, `04-03-PLAN.md`, `04-04-PLAN.md` | User can inspect pending builds in a queue timeline organized by execute tick.         | ✓ SATISFIED | Pending grouping helper in `apps/web/src/economy-view-model.ts:74`; timeline render in `apps/web/src/client.ts:626`; helper tests in `tests/web/economy-view-model.test.ts:49`; state pending rows in `packages/rts-engine/rts.ts:1270`.                                 |

Plan requirement IDs declared across Phase 4 plans: `ECON-01`, `ECON-02`, `ECON-03`, `UX-01` (`04-01-PLAN.md:12`, `04-02-PLAN.md:13`, `04-03-PLAN.md:16`, `04-04-PLAN.md:15`).
Phase 4 requirement IDs in `REQUIREMENTS.md`: `ECON-01`, `ECON-02`, `ECON-03`, `UX-01` (`.planning/REQUIREMENTS.md:84`).
Orphaned requirement IDs: none.

### Anti-Patterns Found

| File                        | Line | Pattern                       | Severity | Impact                                           |
| --------------------------- | ---- | ----------------------------- | -------- | ------------------------------------------------ |
| `apps/server/src/server.ts` | 1663 | Runtime startup `console.log` | ℹ️ Info  | Expected startup log; not a placeholder or stub. |

No blocker/warning anti-patterns found (`TODO`/`FIXME`/placeholder stubs not detected in Phase 4 key files).

### Human Verification Required

### 1. Clean-start browser bootstrap and room entry

**Test:** In a clean environment, run `npm start`, open the served page, join a room, and claim a slot.
**Expected:** `status` reaches Connected, lifecycle leaves initial waiting state, and HUD/queue controls become interactive after membership events.
**Why human:** Final confidence requires real browser runtime and interaction flow, not just socket-level assertions.

### 2. Connection-loss messaging visibility

**Test:** With browser open, briefly stop/restart server (or simulate network interruption) and watch lifecycle/status/message surfaces.
**Expected:** UI clearly shows disconnect/reconnect states and recovery guidance, then clears error state after reconnect.
**Why human:** Message clarity/timing under transient failures is best evaluated by a person.

### 3. Economy cue readability during active play

**Test:** During active match ticks, watch resource/income pulses, delta chip updates, and pending timeline updates while issuing queue actions.
**Expected:** Cues are visible and understandable without obscuring core build decisions.
**Why human:** Visual readability and perceived UX quality are subjective and cannot be proven by static checks.

### Gaps Summary

No blocking implementation gaps remain in Phase 4. The prior bootstrap blocker is closed by strict dist-asset enforcement (`apps/server/src/server.ts:82`, `apps/server/src/server.ts:1659`), start-command build guardrails (`package.json:20`), and executable-module + membership smoke coverage (`tests/integration/server/bootstrap-smoke.test.ts:45`). Phase goal behavior is verified in code/tests; remaining work is human UX confirmation.

Automated verification executed:

- `npm run build`
- `npm run build:server`
- `npx vitest run tests/integration/server/bootstrap-smoke.test.ts tests/integration/server/server.test.ts tests/web/economy-view-model.test.ts` → passed (3 files, 15 tests)

---

_Verified: 2026-03-01T08:33:24Z_
_Verifier: OpenCode (gsd-verifier)_
