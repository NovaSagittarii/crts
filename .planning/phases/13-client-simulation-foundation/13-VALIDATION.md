---
phase: 13
slug: client-simulation-foundation
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-29
---

# Phase 13 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 3.1.1 |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `npm run test:fast` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~30 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npm run test:fast`
- **After every plan wave:** Run `npm test`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 13-01-01 | 01 | 1 | SIM-01 | unit | `npx vitest run packages/rts-engine/rts.test.ts -t "fromPayload"` | Exists (file), tests needed (Wave 0) | ⬜ pending |
| 13-01-02 | 01 | 1 | SIM-01 | unit | `npx vitest run packages/rts-engine/rts.test.ts -t "fromPayload"` | Exists (file), tests needed (Wave 0) | ⬜ pending |
| 13-02-01 | 02 | 1 | SIM-01 | unit | `npx vitest run tests/web/client-simulation.test.ts` | Does not exist (Wave 0) | ⬜ pending |
| 13-02-02 | 02 | 1 | SIM-02 | unit | `npx vitest run tests/web/client-simulation.test.ts -t "tick cadence"` | Does not exist (Wave 0) | ⬜ pending |
| 13-03-01 | 03 | 2 | SIM-01 | integration | `npx vitest run tests/integration/server/lockstep-shadow.test.ts` | Exists (file), new tests needed | ⬜ pending |
| 13-03-02 | 03 | 2 | SIM-01 | unit | `npx vitest run tests/web/client-simulation.test.ts -t "rejection"` | Does not exist (Wave 0) | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/web/client-simulation.test.ts` — stubs for SIM-01 (client sim lifecycle), SIM-02 (tick cadence)
- [ ] `packages/rts-engine/rts.test.ts` additions — stubs for SIM-01 (fromPayload hash equivalence)
- [ ] Framework install: none needed — vitest is already configured

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Visual rendering of client sim state | SIM-01 | Canvas rendering requires browser | Open browser, start match, verify grid renders correctly |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
