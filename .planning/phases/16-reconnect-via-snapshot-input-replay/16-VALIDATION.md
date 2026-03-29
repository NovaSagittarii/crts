---
phase: 16
slug: reconnect-via-snapshot-input-replay
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-29
---

# Phase 16 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest |
| **Config file** | vitest.config.ts |
| **Quick run command** | `npm run test:fast` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~70 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npm run test:fast`
- **After every plan wave:** Run `npm test`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 70 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 16-01-01 | 01 | 1 | RECON-01 | unit | `npx vitest run tests/web/client-simulation.test.ts` | ✅ | ⬜ pending |
| 16-01-02 | 01 | 1 | RECON-01 | unit+build | `npm run test:fast && npm run build` | ✅ | ⬜ pending |
| 16-02-01 | 02 | 2 | RECON-01 | integration | `npx vitest run tests/integration/server/reconnect-replay.test.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/integration/server/reconnect-replay.test.ts` — integration test stubs for reconnect replay

*Existing infrastructure covers unit test requirements.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Visual reconnect in browser | RECON-01 | Requires live dev server with disconnect | Start match, close tab, reopen, observe seamless rejoin in console |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 70s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
