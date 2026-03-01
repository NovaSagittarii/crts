# Stack Research

**Domain:** v0.0.2 Conway RTS gameplay expansion (deterministic engine + canvas UI)
**Researched:** 2026-03-01
**Confidence:** HIGH for required changes; MEDIUM for optional ergonomics libraries

## Recommended Stack

### Required vs Optional Changes

**Required for v0.0.2 scope**

1. Align Socket.IO server/client to the same current patch line (`4.8.3`) before adding new rotate/mirror/destroy events.
2. Add property-based testing (`fast-check`) for transform/build-zone invariants so backend-first delivery catches deterministic edge cases before UI work.
3. Keep runtime rendering stack as Canvas 2D + Pointer Events (no framework or renderer migration) for pan/zoom and overlays.

**Optional (only if complexity increases)**

1. Add `zod` runtime schemas at socket boundaries if ad-hoc payload guards become hard to maintain.
2. Add `d3-zoom` only if custom pointer/wheel camera controls become fragile across devices.
3. Upgrade `vite`/`vitest` together only when you explicitly schedule tooling modernization.

### Core Technologies

| Technology                     | Version                                      | Purpose                                                                | Why Recommended                                                                                                                 |
| ------------------------------ | -------------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Socket.IO (server + client)    | `4.8.3`                                      | Typed event transport for new placement transforms and destroy actions | New milestone adds event surface area; version parity avoids protocol drift while preserving current server-authoritative flow. |
| TypeScript                     | `5.4.5` (current baseline), `5.9.3` (target) | Strict typing for new engine geometry and UI modules                   | You can ship v0.0.2 on current strict config; move to 5.9.3 when adopting libs (like Zod 4) that expect TS 5.5+.                |
| Canvas 2D API + Pointer Events | Web platform baseline (widely available)     | Pan/zoom camera and grid overlays without architecture rewrite         | `setTransform`/`scale` and pointer capture already cover milestone camera needs in current `apps/web` canvas architecture.      |
| Vitest                         | `1.6.0` (current), `4.0.18` (upgrade path)   | Deterministic unit/integration testing for backend-first slices        | Existing setup is sufficient for milestone delivery; prioritize new tests now and postpone runner migration unless needed.      |

### Supporting Libraries

| Library      | Version | Purpose                                                                                       | When to Use                                                                                                                         |
| ------------ | ------- | --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `fast-check` | `4.5.3` | Property-based tests for rotate/mirror correctness and build-zone union invariants            | **Required for this milestone** in `packages/rts-engine/*.test.ts` to validate algebraic rules (e.g., 4 rotations return identity). |
| `zod`        | `4.3.6` | Runtime validation for new socket payloads (`build:queue` transform fields, destroy requests) | Optional. Add if manual guards in `apps/server/src/server.ts` become repetitive. Requires TypeScript 5.5+ per official docs.        |
| `d3-zoom`    | `3.0.0` | Cross-device pan/zoom behavior abstraction (wheel, drag, touch)                               | Optional. Use only if native pointer/wheel camera module becomes difficult to stabilize; otherwise keep zero extra UI runtime deps. |

### Development Tools

| Tool                                 | Purpose                                                     | Notes                                                                                                         |
| ------------------------------------ | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Vitest + fast-check                  | Backend-first determinism and invariant testing             | Add focused suites for: transform round-trip, K-tick integrity cadence, and build-area union edge boundaries. |
| Existing `npm run test:quality` gate | Keep requirement-traceable confidence before UI integration | Continue running unit + integration after each backend slice to keep milestone ordering intact.               |
| ESLint + strict TypeScript           | Catch unsafe payload coercions and coordinate math mistakes | Keep explicit numeric normalization and typed payload contracts in `packages/rts-engine/socket-contract.ts`.  |

## Monorepo Integration Points

| Path                                                                          | Milestone Integration                                                                                                                               |
| ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/rts-engine/rts.ts`                                                  | Add generalized structure integrity scheduler, 5x5 base layout logic, radius-union build eligibility, and rotate/mirror-aware template application. |
| `packages/rts-engine/socket-contract.ts`                                      | Extend typed contracts for transform metadata and destroy action payloads/results.                                                                  |
| `apps/server/src/server.ts`                                                   | Validate and normalize incoming transform/destroy payloads before calling engine APIs.                                                              |
| `apps/web/src/` (split from `client.ts`)                                      | Create focused modules for camera controls, overlays, placement controls, structure detail/destroy actions, and lobby/in-game screen transitions.   |
| `packages/rts-engine/*.test.ts` and `tests/integration/server/server.test.ts` | Backend-first tests: deterministic rules first, then event-contract integration coverage.                                                           |

## Installation

```bash
# Required changes
npm install socket.io@^4.8.3
npm install -D fast-check@^4.5.3

# Optional hardening
npm install zod@^4.3.6 d3-zoom@^3.0.0

# Optional only if adopting Zod 4 (TypeScript requirement)
npm install -D typescript@^5.9.3

# Optional tooling modernization (must upgrade together)
npm install -D vite@^7.3.1 vitest@^4.0.18 @vitest/coverage-v8@^4.0.18
```

## Alternatives Considered

| Recommended                                  | Alternative                   | When to Use Alternative                                                              |
| -------------------------------------------- | ----------------------------- | ------------------------------------------------------------------------------------ |
| Native Canvas camera module + Pointer Events | `d3-zoom`                     | Use `d3-zoom` when touch/wheel gesture normalization becomes a recurring bug source. |
| Manual payload guards (current pattern)      | `zod` schemas                 | Use `zod` once event variants multiply and guard duplication starts causing drift.   |
| Integer grid transform helpers in engine     | Generic matrix/math libraries | Use math libraries only if you move beyond orthogonal rotate/mirror transforms.      |

## What NOT to Use

| Avoid                                                      | Why                                                                                                   | Use Instead                                                                            |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| React/Vue UI rewrite for this milestone                    | UI architecture churn does not help gameplay rule delivery; slows backend-first sequencing            | Keep vanilla TypeScript modules and split `apps/web/src/client.ts` into focused files. |
| Pixi/WebGL renderer migration now                          | Large rendering-stack migration for features solvable with Canvas 2D transforms and overlays          | Keep Canvas 2D; revisit GPU renderer only after map scale/perf proves it necessary.    |
| Spatial database/geospatial toolkits for build-zone unions | Union-of-radius-squares is small, deterministic integer-grid math; external spatial stack is overkill | Implement pure grid math in `packages/rts-engine` with invariant tests.                |
| Event-sourcing/CQRS framework adoption                     | Adds operational/model complexity for a 2-player prototype milestone                                  | Keep current authoritative in-memory room model and typed Socket.IO contracts.         |

## Stack Patterns by Variant

**If backend-first slices (recommended for v0.0.2):**

- Implement all new rules in `packages/rts-engine` first.
- Gate each rule with deterministic unit/property tests before touching UI controls.

**If UI pan/zoom polish starts consuming excessive time:**

- Introduce `d3-zoom` only for camera interaction handling.
- Keep rendering and simulation ownership unchanged (Canvas draw path in web app, simulation in packages).

## Version Compatibility

| Package A         | Compatible With                                        | Notes                                                                                            |
| ----------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| `socket.io@4.8.3` | `socket.io-client@4.8.3`                               | Keep server/client on the same patch to reduce event-contract surprises while adding new events. |
| `zod@4.3.6`       | TypeScript `>=5.5` (tested range in docs)              | If staying on TS 5.4.5, keep manual payload guards until TS upgrade is scheduled.                |
| `vitest@4.0.18`   | Vite `>=6`, Node `>=20`                                | Upgrade Vitest and Vite together; do not partially upgrade one without the other.                |
| `d3-zoom@3.0.0`   | `d3-selection@2-3`, `d3-drag@2-3`, `d3-transition@2-3` | `d3-zoom` pulls D3 interaction dependencies; keep it optional unless needed.                     |

## Sources

- [HIGH] Socket.IO TypeScript docs (typed server/client events and validation caveat): https://socket.io/docs/v4/typescript/
- [HIGH] Socket.IO delivery guarantees (ordering guarantees): https://socket.io/docs/v4/delivery-guarantees
- [HIGH] Vite guide (current version and Node requirements): https://vite.dev/guide/
- [HIGH] Vitest guide (Vite/Node requirements): https://vitest.dev/guide/
- [HIGH] Vitest coverage guide (`@vitest/coverage-v8` and provider behavior): https://vitest.dev/guide/coverage.html
- [HIGH] Zod docs (Zod 4 stable, TS 5.5+ tested): https://zod.dev/
- [HIGH] fast-check docs (property-based testing and Vitest compatibility): https://fast-check.dev/
- [HIGH] D3 zoom docs (canvas-compatible pan/zoom behavior): https://d3js.org/d3-zoom
- [HIGH] MDN Canvas `setTransform` and `scale` docs (camera transforms):
  - https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D/setTransform
  - https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D/scale
- [MEDIUM] MDN `wheel` event caveats (non-baseline warning): https://developer.mozilla.org/en-US/docs/Web/API/Element/wheel_event
- [HIGH] MDN pointer events and pointer capture guidance: https://developer.mozilla.org/en-US/docs/Web/API/Pointer_events
- [HIGH] npm registry metadata checked on 2026-03-01 (`npm view <pkg> version/time`) for: `socket.io`, `socket.io-client`, `typescript`, `vite`, `vitest`, `zod`, `fast-check`, `d3-zoom`, `pixi.js`

---

_Stack research for: v0.0.2 Conway RTS gameplay expansion_
_Researched: 2026-03-01_
