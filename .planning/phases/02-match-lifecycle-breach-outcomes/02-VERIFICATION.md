---
phase: 02-match-lifecycle-breach-outcomes
verified: 2026-02-27T11:03:54Z
status: human_needed
score: 3/3 must-haves verified
human_verification:
  - test: 'Finished/defeat UI clarity across desktop and mobile'
    expected: 'Countdown overlay, defeat banner, and finished panel remain legible and unambiguous at common viewport sizes'
    why_human: 'Visual clarity and responsiveness quality cannot be fully validated by static code checks'
  - test: 'End-to-end host restart flow with two real clients'
    expected: 'A client that toggled local lobby view in finished is still pulled into restarted countdown without rejoin'
    why_human: 'Requires interactive multi-client timing/UX confirmation beyond static analysis'
---

# Phase 2: Match Lifecycle & Breach Outcomes Verification Report

**Phase Goal:** Users can start and complete matches through one authoritative lifecycle with unambiguous win/lose outcomes.
**Verified:** 2026-02-27T11:03:54Z
**Status:** human_needed
**Re-verification:** No - initial verification

## Goal Achievement

### Observable Truths

| #   | Truth                                                                                                                      | Status     | Evidence                                                                                                                                                                                                                                                                                                                                                                                                     |
| --- | -------------------------------------------------------------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Host can start only when preconditions are satisfied, and lifecycle transitions `lobby -> countdown -> active -> finished` | ✓ VERIFIED | Preconditions derived in `apps/server/src/server.ts:718`; start/restart guarded via `transitionMatchLifecycle` in `apps/server/src/server.ts:1161`; countdown->active in `apps/server/src/server.ts:821`; active->finished in `apps/server/src/server.ts:1368`; integration assertions in `tests/integration/server/match-lifecycle.test.ts:304` and `tests/integration/server/match-lifecycle.test.ts:595`. |
| 2   | Match ends through one canonical breach rule with explicit winner/loser outcomes                                           | ✓ VERIFIED | Canonical outcome builder in `packages/rts-engine/rts.ts:1147` and `packages/rts-engine/rts.ts:1220`; deterministic ranking contract in `packages/rts-engine/match-lifecycle.ts:61`; authoritative finished emit includes `winner/ranked/comparator` in `apps/server/src/server.ts:794`; integration assertions in `tests/integration/server/match-lifecycle.test.ts:490`.                                   |
| 3   | Defeated user is blocked from gameplay actions and receives clear defeat state                                             | ✓ VERIFIED | Server mutation gate rejects defeated users (`reason: defeated`) in `apps/server/src/server.ts:866`; integration assertion in `tests/integration/server/match-lifecycle.test.ts:520`; client enforces read-only controls/banner in `apps/web/src/client.ts:373` and `apps/web/src/client.ts:439`; defeat error handling persists messaging in `apps/web/src/client.ts:1156`.                                 |

**Score:** 3/3 truths verified

### Required Artifacts

| Artifact                                           | Expected                                                   | Status     | Details                                                                                                                                             |
| -------------------------------------------------- | ---------------------------------------------------------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/rts-engine/match-lifecycle.ts`           | Lifecycle transitions + deterministic outcome ranking      | ✓ VERIFIED | Exists, substantive (221 lines), consumed by server and engine (`apps/server/src/server.ts:34`, `packages/rts-engine/rts.ts:12`).                   |
| `packages/rts-engine/rts.ts`                       | Authoritative core/breach/outcome state                    | ✓ VERIFIED | Exists, substantive (1228 lines), emits canonical outcome via `determineMatchOutcome` (`packages/rts-engine/rts.ts:1151`).                          |
| `packages/rts-engine/match-lifecycle.test.ts`      | Unit coverage for lifecycle/ranking                        | ✓ VERIFIED | Exists and validates transitions/ranking contract; passed in Vitest run (5 tests).                                                                  |
| `packages/rts-engine/rts.test.ts`                  | Unit coverage for HP/build radius semantics                | ✓ VERIFIED | Exists, substantive coverage for HP breach and buildRadius behavior (`packages/rts-engine/rts.test.ts:307`, `packages/rts-engine/rts.test.ts:360`). |
| `apps/server/src/server.ts`                        | Runtime lifecycle authority and mutation lockouts          | ✓ VERIFIED | Exists, substantive (1446 lines), wires lifecycle, finish emit, restart, and defeat lockouts.                                                       |
| `apps/server/src/lobby-session.ts`                 | Reconnect hold/connection precondition support             | ✓ VERIFIED | Exists, substantive (335 lines), exposes `isSessionConnected` and `hasPendingHoldForRoom` used by start guards.                                     |
| `tests/integration/server/match-lifecycle.test.ts` | Integration lifecycle/outcome contract checks              | ✓ VERIFIED | Exists with end-to-end checks across start/cancel/finish/restart/defeat; passed in Vitest run (3 tests).                                            |
| `apps/web/index.html`                              | Countdown/finished/defeat UI containers                    | ✓ VERIFIED | Exists, includes overlay/panel/banner DOM anchors (`apps/web/index.html:802`, `apps/web/index.html:813`, `apps/web/index.html:680`).                |
| `apps/web/src/client.ts`                           | Client lifecycle/results/defeat wiring                     | ✓ VERIFIED | Exists, substantive (1383 lines), listens/emits lifecycle events and enforces client read-only mode.                                                |
| `apps/server/AGENTS.md`                            | Server contract documentation for lifecycle reasons/events | ✓ VERIFIED | Updated event/lifecycle reason contract documented (`apps/server/AGENTS.md:43`).                                                                    |
| `apps/web/AGENTS.md`                               | Web contract documentation for finished/restart/defeat     | ✓ VERIFIED | Updated client finished/restart expectations documented (`apps/web/AGENTS.md:51`).                                                                  |

### Key Link Verification

| From                                     | To                                                 | Via                                                                                 | Status | Details                                                                                                                                                                                                                                                                                                                         |
| ---------------------------------------- | -------------------------------------------------- | ----------------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/rts-engine/match-lifecycle.ts` | `packages/rts-engine/rts.ts`                       | Lifecycle/outcome helpers consumed by engine                                        | WIRED  | `determineMatchOutcome` imported and used in `packages/rts-engine/rts.ts:9` and `packages/rts-engine/rts.ts:1151`.                                                                                                                                                                                                              |
| `packages/rts-engine/rts.ts`             | `StructureTemplate.buildArea`                      | Active structures project `buildArea` to `buildRadius`                              | WIRED  | `structure.buildRadius = active ? template.buildArea : 0` in `packages/rts-engine/rts.ts:575`; behavior verified in `packages/rts-engine/rts.test.ts:307`.                                                                                                                                                                      |
| `apps/server/src/server.ts`              | `packages/rts-engine/match-lifecycle.ts`           | Socket handlers delegate lifecycle legality and finish transition to engine helpers | WIRED  | `transitionMatchLifecycle` used for start/cancel/finish paths in `apps/server/src/server.ts:1161`, `apps/server/src/server.ts:1222`, `apps/server/src/server.ts:1368`.                                                                                                                                                          |
| `apps/server/src/server.ts`              | `tests/integration/server/match-lifecycle.test.ts` | Integration suite asserts lifecycle event contracts                                 | WIRED  | Tests assert `room:countdown`, `room:match-started`, `room:match-finished`, and `room:error` in `tests/integration/server/match-lifecycle.test.ts:356`, `tests/integration/server/match-lifecycle.test.ts:433`, `tests/integration/server/match-lifecycle.test.ts:254`, `tests/integration/server/match-lifecycle.test.ts:302`. |
| `apps/web/src/client.ts`                 | `apps/server/src/server.ts`                        | Client listens/emits lifecycle + defeat contract events                             | WIRED  | Listeners for `room:membership`, `room:match-finished`, `room:error` in `apps/web/src/client.ts:1168`, `apps/web/src/client.ts:1190`, `apps/web/src/client.ts:1153`; restart emit via `room:start` in `apps/web/src/client.ts:1353`.                                                                                            |
| `apps/web/src/client.ts`                 | `apps/web/index.html`                              | DOM overlay/panel/banner wiring via element IDs and class toggles                   | WIRED  | Client resolves required elements and toggles visibility/state (`apps/web/src/client.ts:32`, `apps/web/src/client.ts:545`, `apps/web/src/client.ts:557`) for IDs defined in `apps/web/index.html:680`, `apps/web/index.html:802`, `apps/web/index.html:813`.                                                                    |

### Requirements Coverage

| Requirement | Source Plan                                       | Description                                                                                    | Status      | Evidence                                                                                                                                                                                                                                                         |
| ----------- | ------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MATCH-01    | `02-01-PLAN.md`, `02-02-PLAN.md`, `02-03-PLAN.md` | Host can start only when lifecycle preconditions are met, with authoritative transition chain. | ✓ SATISFIED | Precondition computation and transition guards in `apps/server/src/server.ts:718` and `apps/server/src/server.ts:1161`; integration checks in `tests/integration/server/match-lifecycle.test.ts:304` and `tests/integration/server/match-lifecycle.test.ts:595`. |
| MATCH-02    | `02-01-PLAN.md`, `02-02-PLAN.md`, `02-03-PLAN.md` | Match ends by canonical breach rule with explicit winner/loser outcomes.                       | ✓ SATISFIED | Canonical breach outcome in `packages/rts-engine/rts.ts:1147`; finished payload emit in `apps/server/src/server.ts:794`; integration assertions in `tests/integration/server/match-lifecycle.test.ts:490`.                                                       |
| MATCH-03    | `02-02-PLAN.md`, `02-03-PLAN.md`                  | Defeated user is lockout-gated from gameplay and shown clear defeat status.                    | ✓ SATISFIED | Defeat mutation gate in `apps/server/src/server.ts:866`; defeated rejection test in `tests/integration/server/match-lifecycle.test.ts:520`; client persistent defeat/spectating UX in `apps/web/src/client.ts:392` and `apps/web/src/client.ts:1156`.            |

All requirement IDs found in phase plan frontmatter are accounted for in `.planning/REQUIREMENTS.md`: MATCH-01, MATCH-02, MATCH-03. No orphaned Phase 2 requirement IDs were found.

### Anti-Patterns Found

| File | Line | Pattern                                                                                                                         | Severity | Impact                                         |
| ---- | ---- | ------------------------------------------------------------------------------------------------------------------------------- | -------- | ---------------------------------------------- |
| None | -    | No blocker stub markers (`TODO/FIXME/PLACEHOLDER`), empty handlers, or placeholder implementations detected in phase key files. | -        | No anti-pattern blockers for goal achievement. |

### Human Verification Required

### 1. Finished and Defeat UI Clarity

**Test:** Run two browser clients through start -> countdown -> active -> breach -> finished and inspect defeat banner plus results panel on desktop and mobile widths.
**Expected:** Defeat state remains obvious, controls stay read-only for defeated user, and finished panel copy is clear and legible.
**Why human:** Perceived clarity/legibility is subjective and cannot be fully validated through static code or grep checks.

### 2. Finished Lobby-View Restart Pull-Back

**Test:** In `finished`, click "Return to Lobby View" on one client, then restart as host.
**Expected:** Client remains in room (no `room:leave`) and is pulled into restarted countdown automatically.
**Why human:** Requires interactive UX timing validation across client state transitions.

### Gaps Summary

No automated implementation gaps were found against phase must-haves; lifecycle, canonical breach outcomes, and defeat lockouts are present and wired. Remaining validation is human UX confirmation only.

---

_Verified: 2026-02-27T11:03:54Z_
_Verifier: OpenCode (gsd-verifier)_
