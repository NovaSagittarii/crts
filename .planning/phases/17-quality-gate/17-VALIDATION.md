---
phase: 17
slug: quality-gate
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-29
---

# Phase 17 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest + fast-check |
| **Config file** | vitest.config.ts |
| **Quick run command** | `npm run test:fast` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~90 seconds (includes property tests) |

---

## Sampling Rate

- **After every task commit:** Run `npm run test:fast`
- **After every plan wave:** Run `npm test`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 90 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 17-01-01 | 01 | 1 | QUAL-01 | property-based | `npx vitest run tests/web/lockstep-determinism.test.ts` | ❌ W0 | ⬜ pending |
| 17-01-02 | 01 | 1 | QUAL-01 | integration | `npx vitest run tests/integration/server/arraybuffer-roundtrip.test.ts` | ❌ W0 | ⬜ pending |
| 17-01-03 | 01 | 1 | QUAL-01 | regression | `npm test` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `fast-check` npm package installed as dev dependency
- [ ] Test file stubs created by tasks themselves

---

## Manual-Only Verifications

*None — all phase behaviors have automated verification.*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 90s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
