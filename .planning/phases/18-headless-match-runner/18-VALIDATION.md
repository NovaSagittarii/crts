---
phase: 18
slug: headless-match-runner
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-01
---

# Phase 18 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property               | Value                                       |
| ---------------------- | ------------------------------------------- |
| **Framework**          | vitest 4.0.18                               |
| **Config file**        | `vitest.config.ts` (root)                   |
| **Quick run command**  | `npx vitest run --dir packages/bot-harness` |
| **Full suite command** | `npm run test:unit`                         |
| **Estimated runtime**  | ~5 seconds                                  |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run --dir packages/bot-harness`
- **After every plan wave:** Run `npm run test:fast`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 5 seconds

---

## Per-Task Verification Map

| Task ID  | Plan | Wave | Requirement | Test Type | Automated Command                                             | File Exists | Status     |
| -------- | ---- | ---- | ----------- | --------- | ------------------------------------------------------------- | ----------- | ---------- |
| 18-01-01 | 01   | 1    | HARN-01     | unit      | `npx vitest run packages/bot-harness/match-runner.test.ts -x` | ❌ W0       | ⬜ pending |
| 18-01-02 | 01   | 1    | HARN-01     | unit      | `npx vitest run packages/bot-harness/match-runner.test.ts -x` | ❌ W0       | ⬜ pending |
| 18-01-03 | 01   | 1    | HARN-01     | unit      | `npx vitest run packages/bot-harness/match-runner.test.ts -x` | ❌ W0       | ⬜ pending |
| 18-02-01 | 02   | 1    | BAL-01      | unit      | `npx vitest run packages/bot-harness/match-logger.test.ts -x` | ❌ W0       | ⬜ pending |
| 18-02-02 | 02   | 1    | BAL-01      | unit      | `npx vitest run packages/bot-harness/match-logger.test.ts -x` | ❌ W0       | ⬜ pending |
| 18-02-03 | 02   | 1    | BAL-01      | unit      | `npx vitest run packages/bot-harness/match-runner.test.ts -x` | ❌ W0       | ⬜ pending |
| 18-03-01 | 03   | 1    | HARN-01     | unit      | `npx vitest run packages/bot-harness/match-runner.test.ts -x` | ❌ W0       | ⬜ pending |
| 18-03-02 | 03   | 1    | HARN-01     | unit      | `npx vitest run packages/bot-harness/match-runner.test.ts -x` | ❌ W0       | ⬜ pending |
| 18-04-01 | 04   | 2    | HARN-01     | unit      | `npx vitest run packages/bot-harness/random-bot.test.ts -x`   | ❌ W0       | ⬜ pending |

_Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky_

---

## Wave 0 Requirements

- [ ] `packages/bot-harness/match-runner.test.ts` — stubs for HARN-01 (match lifecycle, determinism, no leaks)
- [ ] `packages/bot-harness/match-logger.test.ts` — stubs for BAL-01 (NDJSON format, build orders, hash trail)
- [ ] `packages/bot-harness/random-bot.test.ts` — stubs for HARN-01 (valid placements)
- [ ] vitest.config.ts alias: add `#bot-harness` alias if import alias is created
- [ ] tsconfig.base.json paths: add `#bot-harness` path mapping
- [ ] package.json imports: add `#bot-harness` import mapping

---

## Manual-Only Verifications

_All phase behaviors have automated verification._

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 5s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
