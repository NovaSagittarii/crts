# Stack Research

**Domain:** v0.0.3 template/grid cleanup refactor (`template.grid()` + `GridView` unification)
**Researched:** 2026-03-03
**Confidence:** HIGH

## Recommended Stack

### Milestone Decision (Opinionated)

For this milestone, **do not add new npm dependencies**. Ship the refactor on the existing TypeScript/Node/Vitest stack and keep the lockfile stable.

Rationale: this is an internal API consolidation (`template` + `offset-template` path unification), not a new runtime capability. Additional libraries add migration and regression risk without helping deliver the core outcome.

### Core Technologies

| Technology                        | Version                                            | Purpose                                                                                    | Why Recommended                                                                               |
| --------------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| TypeScript                        | `^5.4.5` (keep)                                    | Define `GridView` API (`translate`, `rotate`, `applyTransform`, `cells`) with strict types | Existing strict config is already sufficient for this refactor; no language upgrade required. |
| Node ESM + package import aliases | Current repo setup (`#rts-engine`, `#conway-core`) | Share one canonical `GridView` API between engine, server, web, and tests                  | Keeps refactor scoped to internal modules and avoids runtime wiring churn.                    |
| Vitest                            | `^1.6.0` (keep)                                    | Lock deterministic parity before/after deduplication                                       | Existing unit/integration harness already validates deterministic behavior.                   |
| ESLint + typescript-eslint        | `^9.19.0` + `^8.26.0` (keep)                       | Catch unsafe refactor drift (mutation, unused APIs, type holes)                            | Typed linting is already wired to both server and client TS configs.                          |

### Supporting Libraries

| Library                                                  | Version | Purpose                                                                             | When to Use                                                                    |
| -------------------------------------------------------- | ------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| **None (new external libs)**                             | n/a     | Keep milestone lean and behavior-stable                                             | Default for this milestone.                                                    |
| `packages/rts-engine/placement-transform.ts` (internal)  | current | Reuse existing transform math under `GridView.applyTransform` and `GridView.rotate` | Use as the single transform implementation source; avoid duplicate math paths. |
| `packages/rts-engine/index.ts` export surface (internal) | current | Expose `GridView`/types to web/server/tests through `#rts-engine`                   | Use when migrating call sites off template/offset-template split APIs.         |

### Development Tools

| Tool                                      | Purpose                                                       | Notes                                                                                                 |
| ----------------------------------------- | ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `npm run test:unit` (Vitest)              | Verify `GridView` transforms and `cells()` output determinism | Add focused tests in `packages/rts-engine/*.test.ts` for translate/rotate/applyTransform equivalence. |
| `npm run test:integration:serial`         | Guard server-authoritative parity after internal API swap     | Keep existing gameplay scenarios unchanged; refactor should be behavior-preserving.                   |
| `npm run lint` + TypeScript strict checks | Prevent contract/type regressions during API deduplication    | Ensure old duplicated pathways are removed, not shadowed.                                             |

## Integration Points with Current TypeScript Stack

| Integration Point                                                           | Change Needed                                                                  | Why                                                                                |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| `packages/rts-engine/rts.ts`                                                | Route template cell iteration through `template.grid().cells()`                | Eliminates duplicate template vs offset-template code paths at the engine source.  |
| `packages/rts-engine/placement-transform.ts`                                | Keep as core transform utility backing `GridView` methods                      | Preserves already-validated transform behavior and deterministic ordering.         |
| `packages/rts-engine/index.ts`                                              | Export `GridView` and related types from package entrypoint                    | Keeps imports directional and avoids ad-hoc type copies in apps/tests.             |
| `apps/web/src/placement-transform-view-model.ts` + `apps/web/src/client.ts` | Consume refactored engine API without introducing client-side simulation logic | Maintains server-authoritative contract while simplifying template handling paths. |
| `packages/rts-engine/*.test.ts` and `tests/integration/server/*.test.ts`    | Add parity tests for `GridView.cells()` transformed output                     | Refactor safety net: same gameplay outcomes, fewer pathways.                       |

## Installation

```bash
# No dependency additions required for v0.0.3 refactor.
# Keep package.json/package-lock.json unchanged.

# Validate refactor safety with existing toolchain
npm run test:unit
npm run test:integration:serial
npm run lint
```

## Alternatives Considered

| Recommended                                      | Alternative                                             | When to Use Alternative                                                                                      |
| ------------------------------------------------ | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Internal `GridView` + existing transform helpers | Add geometry/math library (`gl-matrix`, `mathjs`, etc.) | Only if future scope expands to non-orthogonal transforms or continuous-space geometry (not this milestone). |
| Existing Vitest deterministic suites             | Add new property-testing framework now                  | Only if standard test cases fail to catch transform regressions; keep out of this refactor by default.       |
| Keep current TS/Vitest/Vite versions             | Toolchain upgrades during refactor                      | Only in a dedicated tooling milestone; do not combine with behavior-preserving cleanup.                      |

## What NOT to Use

| Avoid                                                           | Why                                                                         | Use Instead                                                                  |
| --------------------------------------------------------------- | --------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Frontend framework migration (React/Vue/Svelte)                 | Unrelated architecture churn for an internal engine refactor                | Keep current Vite + TypeScript web client and consume `#rts-engine` exports. |
| External matrix/geometry libs for 90-degree grid transforms     | Overkill dependency surface for integer-grid operations already implemented | Reuse `placement-transform.ts` and expose via `GridView`.                    |
| Runtime schema layer additions (`zod`, `io-ts`) for this change | No new network boundary or payload shape required by this milestone         | Keep existing runtime validation pathways unchanged.                         |
| Combined dependency modernization (TS/Vite/Vitest/Socket.IO)    | High blast radius and hard-to-isolate regressions during cleanup work       | Schedule separately after refactor lands and behavior is locked.             |

## Stack Patterns by Variant

**If milestone remains pure refactor (recommended):**

- Add zero dependencies.
- Implement `GridView` as internal TypeScript API + tests only.

**If milestone expands to new gameplay behavior (not recommended in this slice):**

- Re-evaluate stack changes in a separate scoped milestone.
- Keep protocol/tooling upgrades isolated from template/grid refactor commits.

## Version Compatibility

| Package A           | Compatible With                                 | Notes                                                                                                     |
| ------------------- | ----------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `typescript@^5.4.5` | `vitest@^1.6.0`, `typescript-eslint@^8.26.0`    | Current repo config is sufficient for `GridView` API typing and test coverage.                            |
| `vite@^5.2.0`       | current web TS setup (`tsconfig.client.json`)   | No build-system change required for this internal refactor.                                               |
| `socket.io@^4.7.5`  | `socket.io-client@^4.8.3` (existing repo state) | Refactor does not require socket contract evolution; avoid touching transport versions in this milestone. |

## Sources

- [HIGH] `.planning/PROJECT.md` — v0.0.3 scope, constraints, and out-of-scope guidance.
- [HIGH] `package.json` — current dependency/tooling versions and scripts.
- [HIGH] `tsconfig.base.json`, `tsconfig.json`, `tsconfig.client.json` — strict TS settings and runtime targets.
- [HIGH] `packages/rts-engine/placement-transform.ts` — existing shared transform implementation to reuse.
- [HIGH] `packages/rts-engine/index.ts` — package export integration point.
- [HIGH] `apps/web/src/placement-transform-view-model.ts` — current web integration with shared transform types.
- [HIGH] `vitest.config.ts` — existing deterministic test harness and package alias wiring.

---

_Stack research for: v0.0.3 template/grid cleanup refactor_
_Researched: 2026-03-03_
