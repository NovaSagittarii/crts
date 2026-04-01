---
phase: 22
slug: structure-strength-ratings
status: approved
nyquist_compliant: true
wave_0_complete: true
created: 2026-04-01
---

# Phase 22 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest |
| **Config file** | `vitest.config.ts` (root) |
| **Quick run command** | `npx vitest run packages/bot-harness/analysis/` |
| **Full suite command** | `npm run test:unit` |
| **Estimated runtime** | ~5 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run packages/bot-harness/analysis/ -x`
- **After every plan wave:** Run `npm run test:unit`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 5 seconds

---

## Per-Task Verification Map

All plans use inline TDD — tests created within the same task as implementation.

---

## Wave 0 Requirements

All plans use inline TDD — no separate Wave 0 needed.

---

## Manual-Only Verifications

*All phase behaviors have automated verification.*

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify commands
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covered via inline TDD
- [x] No watch-mode flags
- [x] Feedback latency < 5s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved
