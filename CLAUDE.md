# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

TypeScript multiplayer Conway's Game of Life + RTS prototype using Socket.IO. Server runs on port 3000; Vite dev server proxies `/socket.io` to it from port 5173.

## Commands

```bash
# Development
npm run dev              # Vite + server concurrently
npm run dev:server       # Server only (hot-reload via tsx)

# Build
npm run build            # Vite client build
npm run build:server     # TypeScript compile for server

# Tests
npm test                 # All tests
npm run test:unit        # Package unit tests only
npm run test:web         # Web view-model tests only
npm run test:fast        # Unit + web (quick feedback loop)
npm run test:integration # All integration tests
npm run test:integration:light  # Smoke/lobby/destroy/quality-gate
npm run test:integration:heavy  # Server reliability/reconnect/match lifecycle
npm run test:watch       # Watch mode

# Lint / Format
npm run lint             # ESLint with TypeScript type-checking
npm run lint:fix         # Auto-fix
npm run format           # Prettier
npm run format:check     # Check only
```

To run a single test file: `npx vitest run <path/to/file.test.ts>`

## Architecture

### Layer Boundaries

```
apps/      — runtime-specific (server bootstrap, socket lifecycle, browser UI)
packages/  — deterministic, runtime-agnostic domain logic
tests/     — integration (cross-runtime) and web (Node-run view-model) tests
```

Import direction is strict: `apps/*` may import from `packages/*`; `packages/*` must never import from `apps/*` or use Socket.IO/Express/DOM APIs. Package APIs are consumed via aliases:

```ts
import { ... } from '#conway-core';
import { ... } from '#rts-engine';
```

`conway-rts/` is a legacy/reference-only subtree excluded from all active build/lint/test configs — do not edit it unless explicitly asked.

### packages/conway-core

`Grid` is the canonical Conway aggregate. Cells are `0`/`1`; `Grid.step()` mutates in place using B3/S23 rules. Topology defaults to `torus` (wrapping); `flat` is non-wrapping. `Grid.toPacked()` / `Grid.fromPacked()` must maintain bit-level fidelity. Treat `Grid` internals as opaque — use its methods, not direct byte-buffer access.

### packages/rts-engine

Owns rooms, teams, structures, build queues, economy, and defeat logic. Key files:

- `rts.ts` — main engine, `RtsEngine` static methods + `RtsRoom` instance API
- `socket-contract.ts` — **canonical source of all socket event names and payload shapes**
- `lobby.ts` — `LobbyRoom` aggregate for pre-match lifecycle
- `structure.ts` — template definitions and core layout parsing
- `match-lifecycle.ts` — room state transitions and victory conditions
- `build-placement-evaluator.ts` — queue validation
- `determinism-hash.ts` — state hashing for lockstep verification

**Tick order is deterministic and must be preserved:**

1. Process team economy and due queued events
2. Apply accepted build templates
3. Step Conway grid
4. Resolve core integrity checks; mark defeated teams
5. Compute match outcome; drain pending queue as `match-finished` rejections when finished

Defeat condition: core health reaching zero. `RtsRoom.fromState` only accepts states created by `RtsEngine.createRoomState` / `RtsEngine.createRoom`.

Prefer `RtsRoom` instance methods over static `RtsEngine` room APIs for room-scoped behavior (Phase 2/3 migration is complete).

### apps/server

HTTP/Socket.IO wiring only. Socket event payload shapes come from `socket-contract.ts` — do not re-declare them here. Validate payloads at socket boundaries before calling engine functions. Room status transitions are coordinator-driven: `lobby → countdown → active → finished`. Gameplay mutations are queue-only (`build:queue`, `destroy:queue`).

### apps/web

Browser client: canvas UI, socket orchestration, view-models and controllers. Tests for view-models and controllers live in `tests/web/`.

## Testing Placement

| Test type                                  | Location                    |
| ------------------------------------------ | --------------------------- |
| Deterministic unit tests for a package     | Co-located in `packages/*`  |
| Cross-runtime / Socket.IO contract tests   | `tests/integration/server/` |
| Node-run web view-model / controller tests | `tests/web/`                |

Integration tests: use fixture builders (`createIntegrationTest`, `createRoomTest`, `createMatchTest`, `createLockstepTest`) from `tests/integration/server/fixtures.ts` and siblings before writing bespoke setup. Always use ephemeral ports (`port: 0`). Teardown order: close clients first, then stop server.

## TypeScript / Style

- Strict mode; avoid `any`
- Explicit `.js` extensions in relative imports
- Explicit return types for exported functions
- Interfaces for object shapes; type aliases for unions
- Runtime payload validation at socket/network boundaries
- Keep `npm run lint` passing (ESLint + `typescript-eslint` `recommendedTypeChecked`)

## Commits

Use Conventional Commits. Commit after each coherent phase of changes.
