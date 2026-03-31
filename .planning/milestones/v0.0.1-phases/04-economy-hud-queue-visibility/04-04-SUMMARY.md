---
phase: 04-economy-hud-queue-visibility
plan: '04'
subsystem: runtime
tags: [bootstrap, static-assets, socket-io, smoke-test]

# Dependency graph
requires:
  - phase: 04-economy-hud-queue-visibility
    provides: Economy HUD/queue interactions from 04-03 that depend on successful browser room bootstrap.
provides:
  - Strict server startup guardrails that refuse source TypeScript fallback and require executable dist client assets in standard runtime mode.
  - Client-side socket/connect/reconnect failure messaging on existing status, lifecycle, and inline message surfaces.
  - Integration smoke coverage for served HTML module executability plus room joined/membership handshake.
affects:
  [phase-05-quality-gate-validation, apps/server, apps/web, tests/integration]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Gate CLI server startup behind dist client asset presence while keeping programmatic test harness startup compatible.
    - Surface socket/bootstrap lifecycle failures in existing UI affordances instead of silent waiting states.
    - Verify browser bootstrap with contract-level integration checks (HTML module entry, JS MIME, room bootstrap events).

key-files:
  created:
    - tests/integration/server/bootstrap-smoke.test.ts
  modified:
    - apps/server/src/server.ts
    - package.json
    - apps/web/src/client.ts

key-decisions:
  - 'Use strict dist-client asset enforcement only for CLI startup mode so production startup fails fast while integration harnesses stay stable.'
  - 'Keep failure visibility within existing #status, #lifecycle-status-line, and inline message/toast UI instead of adding new UI surfaces.'
  - 'Assert bootstrap correctness end-to-end by combining HTML/module checks with room:joined + room:membership socket handshake assertions.'

patterns-established:
  - 'Bootstrap Asset Guard Pattern: server CLI path requires dist/client/index.html before listening.'
  - 'Connection Visibility Pattern: connect/disconnect/reconnect events update status + lifecycle + message/toast feedback consistently.'
  - 'Bootstrap Smoke Pattern: integration suite verifies HTML -> module JS -> socket membership flow on ephemeral server ports.'

requirements-completed: [ECON-01, ECON-02, ECON-03, UX-01]

# Metrics
duration: 12 min
completed: 2026-03-01
---

# Phase 4 Plan 04: Bootstrap Guardrails Summary

**Server startup now enforces executable browser assets, client connection failures are visible in lifecycle/status messaging, and a smoke test proves HTML module bootstrap reaches room membership.**

## Performance

- **Duration:** 12 min
- **Started:** 2026-03-01T08:06:04Z
- **Completed:** 2026-03-01T08:18:39Z
- **Tasks:** 3
- **Files modified:** 4

## Accomplishments

- Hardened server static bootstrap behavior by removing source fallback, adding strict dist-client checks for CLI mode, and keeping programmatic test startup compatible.
- Updated start flow so `npm start` always builds client and server artifacts before launching the dist server entrypoint.
- Added explicit socket connect/reconnect/bootstrap failure messaging in client status/lifecycle/message/toast surfaces, including a bootstrap watchdog.
- Added integration smoke coverage that fetches served HTML/module assets, validates JavaScript MIME/entry expectations, and verifies `room:joined` + `room:membership` handshake.

## task Commits

Each task was committed atomically:

1. **task 1: harden server static bootstrap path to require executable client assets** - `06e21ac` (fix)
2. **task 2: add explicit client connect/bootstrap failure messaging** - `8b3ae18` (fix)
3. **task 3: add automated HTML->module->membership smoke coverage** - `d8f1cbf` (test)

**Plan metadata:** pending

## Files Created/Modified

- `apps/server/src/server.ts` - Enforces dist-client static asset policy and strict CLI startup guard.
- `package.json` - Ensures start command builds client and server artifacts before launch.
- `apps/web/src/client.ts` - Adds connect/reconnect/bootstrap failure visibility and recovery signaling in existing UI surfaces.
- `tests/integration/server/bootstrap-smoke.test.ts` - Validates served HTML module executability and room membership bootstrap handshake.

## Decisions Made

- Strict client-asset enforcement is scoped to CLI startup mode (`clientAssetsMode: 'strict'`) so production paths fail fast while imported server usage remains test-friendly.
- Bootstrap/reconnect failures are surfaced through existing lifecycle/status/message/toast nodes to keep UX discoverable without introducing new UI complexity.
- Smoke verification checks both transport and browser bootstrap contracts (module entry + MIME + socket membership events) to catch regressions observed in Phase 4 verification.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Corrected stale STATE plan counters for Phase 4**

- **Found during:** post-task state updates
- **Issue:** `state advance-plan` treated Phase 4 as `3/3` and did not advance plan counters after 04-04 execution.
- **Fix:** Updated `Current Plan` and `Total Plans in Phase` fields to `4` via state update commands.
- **Files modified:** `.planning/STATE.md`
- **Verification:** Re-read `STATE.md` current-position section and confirmed `Current Plan: 4`, `Total Plans in Phase: 4`.
- **Committed in:** metadata commit

**2. [Rule 3 - Blocking] Corrected Roadmap Phase 4 plan totals/listing after updater no-op**

- **Found during:** roadmap progress update step
- **Issue:** `roadmap update-plan-progress "04"` reported success but Phase 4 roadmap details still listed `Plans: 3 plans` and `3/3` progress.
- **Fix:** Manually updated Phase 4 plan count/list to include `04-04-PLAN.md` and set progress row to `4/4`.
- **Files modified:** `.planning/ROADMAP.md`
- **Verification:** Re-read Phase 4 roadmap section and progress table values after patch.
- **Committed in:** metadata commit

---

**Total deviations:** 2 auto-fixed (2 blocking)
**Impact on plan:** Both fixes keep planning metadata aligned with executed work; implementation scope stayed unchanged.

## Authentication Gates

None.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Bootstrap blockers identified in Phase 4 verification are now covered by runtime guardrails and automated smoke verification.
- Phase 4 plan set is complete (`4/4`) and ready for phase transition / Phase 5 quality-gate work.

---

_Phase: 04-economy-hud-queue-visibility_
_Completed: 2026-03-01_

## Self-Check: PASSED

- FOUND: `.planning/phases/04-economy-hud-queue-visibility/04-04-SUMMARY.md`
- FOUND: `tests/integration/server/bootstrap-smoke.test.ts`
- FOUND COMMIT: `06e21ac`
- FOUND COMMIT: `8b3ae18`
- FOUND COMMIT: `d8f1cbf`
