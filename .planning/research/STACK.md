# Stack Research

**Domain:** Browser-based multiplayer Conway RTS prototype (server-authoritative simulation, TypeScript brownfield)
**Researched:** 2026-02-27
**Confidence:** HIGH for core stack; MEDIUM for scale-out choices

## Recommended Stack

### Core Technologies

| Technology | Version                                | Purpose                                            | Why Recommended                                                                                                                                                 |
| ---------- | -------------------------------------- | -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Node.js    | 22.12+ minimum (target 24.x LTS in CI) | Server runtime for authoritative tick loop         | Fits current repo (`node:22` devcontainer), and is compatible with current Vite/Vitest requirements while keeping upgrade risk low in a brownfield codebase.    |
| TypeScript | 5.9.3                                  | Strict typing across server/client/shared packages | 2025-stable TypeScript baseline with improved Node module interop (`node20` module mode), matching this monorepo's strict TS workflow.                          |
| Socket.IO  | 4.8.3 (server + client)                | Real-time rooms/events and reconnect behavior      | Already integrated; keeps server authority model intact, supports ordered events, typed contracts, and connection recovery features without a protocol rewrite. |
| Express    | 4.22.1 (upgrade from 4.19.2 now)       | Static asset hosting + HTTP wrapper for Socket.IO  | Lowest-risk brownfield upgrade with security/backport maintenance; gameplay/lobby work is higher value than an immediate HTTP framework migration.              |
| Vite       | 7.3.0                                  | Web dev server and production bundling             | Standard 2025 frontend toolchain; fast iteration for lobby/team UI and canvas rendering updates.                                                                |
| Vitest     | 4.0.16                                 | Unit + integration tests                           | Standard Vite-native test stack; ideal for TDD on deterministic `packages/*` logic and socket contract tests.                                                   |

### Supporting Libraries

| Library                                  | Version        | Purpose                                                            | When to Use                                                                                                                                     |
| ---------------------------------------- | -------------- | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| zod                                      | 4.3.4          | Runtime validation for socket payloads                             | Use at every inbound socket boundary (`room:create`, `build:queue`, etc.) to prevent invalid state transitions from untrusted clients.          |
| pino                                     | 10.1.0         | Structured server logs                                             | Use once lobby/team matchmaking starts getting real users; add per-room/player context for debugging desyncs and disconnects.                   |
| @socket.io/redis-streams-adapter + redis | 0.2.3 + 5.10.0 | Multi-node Socket.IO fan-out with replay-friendly stream semantics | Add only when you run more than one game server process/instance. This is the Socket.IO adapter path that works with connection-state recovery. |
| bufferutil + utf-8-validate              | 4.1.0 + 6.0.6  | Optional native acceleration for `ws` operations                   | Add when load tests show CPU pressure in websocket framing/validation. Not required for MVP.                                                    |

### Development Tools

| Tool                         | Purpose                                     | Notes                                                                                                                |
| ---------------------------- | ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Vitest + @vitest/coverage-v8 | Fast unit/integration testing with coverage | Keep package-level deterministic tests as the first TDD layer; use fake timers for tick-driven room tests.           |
| Playwright                   | Browser E2E for multiplayer flows           | Add 2-client scenarios: create room -> join room -> team assignment -> match start -> safe-cell breach outcome.      |
| ESLint + typescript-eslint   | Static analysis for TS runtime boundaries   | Start with recommended+strict configs; prioritize rules around async errors, unsafe casts, and event payload safety. |
| tsx                          | Fast server watch mode in development       | Keep existing `tsx watch` loop; avoid runtime/tooling rewrites while gameplay loop is still evolving.                |
| Prettier                     | Consistent formatting across monorepo       | Keep as non-negotiable CI check to reduce churn in shared package diffs.                                             |

## Installation

```bash
# Core
npm install express@^4.22.1 socket.io@^4.8.3 zod@^4.3.4 pino@^10.1.0

# Supporting (add when needed)
npm install @socket.io/redis-streams-adapter@^0.2.3 redis@^5.10.0 bufferutil@^4.1.0 utf-8-validate@^6.0.6

# Dev dependencies
npm install -D typescript@^5.9.3 @types/node@^25.0.3 socket.io-client@^4.8.3 vite@^7.3.0 vitest@^4.0.16 @vitest/coverage-v8@^4.0.16 @playwright/test@^1.57.0 eslint@^9.39.2 @eslint/js@^9.39.2 typescript-eslint@^8.51.0 tsx@^4.21.0 prettier@^3.7.4
```

## Alternatives Considered

| Recommended                    | Alternative                      | When to Use Alternative                                                                                                            |
| ------------------------------ | -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Socket.IO 4.8.3                | Colyseus                         | Use only if you choose to adopt Colyseus room/state abstractions end-to-end and accept rewriting existing server/client contracts. |
| Express 4.22.1 (now)           | Express 5.2.1                    | Use when API surface expands beyond static hosting and you can budget a regression pass for middleware/route behavior changes.     |
| Default Socket.IO parser       | socket.io-msgpack-parser         | Use when profiling proves payload size is your bottleneck and you can trade off easier network debugging for throughput gains.     |
| Single-process in-memory rooms | Redis-backed multi-node topology | Use when one process can no longer sustain concurrent rooms or regional scaling is required.                                       |

## What NOT to Use

| Avoid                                                  | Why                                                                                    | Use Instead                                                                          |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| WebAssembly simulator rewrite (now)                    | High integration cost for low prototype value; slows gameplay iteration                | Keep deterministic TypeScript simulation and optimize hotspots only after profiling. |
| Protobuf/gRPC transport for this milestone             | Event schema is still changing quickly; protocol hardening now creates migration drag  | Keep Socket.IO events + runtime validation (Zod) until contracts stabilize.          |
| Redis PUB/SUB adapter for recovery-critical sessions   | Does not support packet persistence needed for connection-state recovery semantics     | Use `@socket.io/redis-streams-adapter` when scaling out.                             |
| Forcing `transports: ["websocket"]` in early playtests | Removes long-polling fallback and increases field failure risk on restrictive networks | Keep Socket.IO default transport negotiation for prototype reliability.              |
| Early microservices/Kubernetes split                   | Adds operational complexity before core match loop is validated                        | Keep a single deployable Node service until lobby->match loop is proven.             |

## Stack Patterns by Variant

**If you are shipping the next playable milestone (lobby/team-first, 2-20 concurrent players):**

- Use single Node process + in-memory rooms.
- Keep Socket.IO default adapter and transport defaults.
- Drive TDD with Vitest (unit/integration) and a small Playwright E2E suite for room lifecycle.

**If you move to multi-instance playtests:**

- Add sticky sessions at the load balancer.
- Add `@socket.io/redis-streams-adapter` + Redis.
- Enable Socket.IO connection-state recovery and test recovery paths explicitly.

**If map/tick payloads become bandwidth-heavy:**

- Keep bit-packed grid encoding and send only authoritative deltas where possible.
- Consider custom parser only after measuring a real bottleneck.

## Version Compatibility

| Package A                              | Compatible With                         | Notes                                                                                        |
| -------------------------------------- | --------------------------------------- | -------------------------------------------------------------------------------------------- |
| vite@7.3.0                             | Node.js 20.19+ or 22.12+                | Runtime floor from Vite docs; validates current Node 22 devcontainer path.                   |
| vitest@4.0.16                          | vite>=6 and Node>=20                    | Vitest docs explicitly require this pairing.                                                 |
| typescript-eslint@8.51.0               | TypeScript <6, ESLint 8/9/10            | Safe with TypeScript 5.9.x and ESLint 9.x in this milestone.                                 |
| socket.io@4.8.3                        | socket.io-client@4.8.3                  | Keep same major/minor line for fewer protocol surprises.                                     |
| @socket.io/redis-streams-adapter@0.2.3 | socket.io 4.x (incl. recovery features) | Adapter docs list support for connection-state recovery and note sticky-session requirement. |

## Confidence by Recommendation

| Area                          | Confidence | Reason                                                                                                            |
| ----------------------------- | ---------- | ----------------------------------------------------------------------------------------------------------------- |
| Core runtime + realtime stack | HIGH       | Backed by official docs + current codebase fit + 2025 release data from npm.                                      |
| TDD/tooling recommendations   | HIGH       | Official Vitest/Playwright/typescript-eslint docs and direct compatibility constraints.                           |
| Multi-node scaling path       | MEDIUM     | Official Socket.IO guidance is clear, but this specific codebase has not yet been load-tested in multi-node mode. |

## Sources

- [HIGH] Node.js release lifecycle and status: https://nodejs.org/en/about/previous-releases
- [HIGH] Vite guide (Node version requirements, current major docs): https://vite.dev/guide/
- [HIGH] Vitest guide (requires Vite >=6, Node >=20): https://vitest.dev/guide/
- [HIGH] TypeScript 5.8 release notes (2025-02-28): https://devblogs.microsoft.com/typescript/announcing-typescript-5-8/
- [HIGH] TypeScript 5.9 release notes (2025-08-01): https://devblogs.microsoft.com/typescript/announcing-typescript-5-9/
- [HIGH] Socket.IO docs: intro, delivery guarantees, TypeScript, testing, connection recovery, multiple nodes, performance tuning, custom parser, Redis Streams adapter
  - https://socket.io/docs/v4/
  - https://socket.io/docs/v4/delivery-guarantees
  - https://socket.io/docs/v4/typescript/
  - https://socket.io/docs/v4/testing/
  - https://socket.io/docs/v4/connection-state-recovery
  - https://socket.io/docs/v4/using-multiple-nodes/
  - https://socket.io/docs/v4/performance-tuning/
  - https://socket.io/docs/v4/custom-parser/
  - https://socket.io/docs/v4/redis-streams-adapter/
- [HIGH] Zod docs (v4 stable, TS requirements): https://zod.dev/
- [HIGH] Playwright docs (system requirements, install/update): https://playwright.dev/docs/intro
- [HIGH] typescript-eslint docs (quickstart + supported dependency ranges):
  - https://typescript-eslint.io/getting-started
  - https://typescript-eslint.io/users/dependency-versions
- [HIGH] Package versions and 2025 release windows verified via npm registry metadata (`npm view <pkg> version/time`) on 2026-02-27.

---

_Stack research for: browser-based multiplayer Conway RTS prototype (server-authoritative)_
_Researched: 2026-02-27_
