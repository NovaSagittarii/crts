---
phase: 21
slug: balance-analysis
status: approved
nyquist_compliant: true
wave_0_complete: true
created: 2026-04-01
---

# Phase 21 — Validation Strategy

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

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | Status |
|---------|------|------|-------------|-----------|-------------------|--------|
| 21-01-01 | 01 | 1 | BAL-02 | unit (TDD) | `npx vitest run packages/bot-harness/analysis/stats.test.ts` | ⬜ pending |
| 21-01-02 | 01 | 1 | BAL-02 | unit (TDD) | `npx vitest run packages/bot-harness/analysis/match-log-reader.test.ts` | ⬜ pending |
| 21-02-01 | 02 | 2 | BAL-02 | unit (TDD) | `npx vitest run packages/bot-harness/analysis/win-rate-analyzer.test.ts` | ⬜ pending |
| 21-02-02 | 02 | 2 | BAL-03 | unit (TDD) | `npx vitest run packages/bot-harness/analysis/strategy-classifier.test.ts` | ⬜ pending |
| 21-03-01 | 03 | 3 | BAL-02,03 | unit (TDD) | `npx vitest run packages/bot-harness/analysis/balance-report.test.ts` | ⬜ pending |
| 21-03-02 | 03 | 3 | BAL-02,03 | smoke | `NODE_OPTIONS=--conditions=development npx tsx bin/analyze-balance.ts --help` | ⬜ pending |

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
