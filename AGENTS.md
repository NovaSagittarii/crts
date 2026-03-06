# Agent Guidelines for CRTS

This is a TypeScript multiplayer Conway's Game of Life + RTS prototype using Socket.IO.

## Repository Structure

```text
apps/
  server/src/server.ts
  server/src/lobby-session.ts
  web/index.html
  web/src/client.ts
  web/src/economy-view-model.ts

packages/
  conway-core/grid.ts
  conway-core/grid.test.ts
  conway-core/index.ts
  rts-engine/geometry.ts
  rts-engine/lobby.ts
  rts-engine/lobby.test.ts
  rts-engine/match-lifecycle.ts
  rts-engine/rts.ts
  rts-engine/rts.test.ts
  rts-engine/socket-contract.ts
  rts-engine/spawn.ts
  rts-engine/index.ts

tests/
  integration/server/*.test.ts
  web/economy-view-model.test.ts
```

## Nested AGENTS.md Layout

This repository uses nested AGENTS files for local rules.

- `apps/AGENTS.md`: runtime-layer rules shared by server/web
- `apps/server/AGENTS.md`: Socket.IO server runtime guardrails (contract source: `packages/rts-engine/socket-contract.ts`)
- `apps/web/AGENTS.md`: browser client behavior + UI/state rules
- `packages/AGENTS.md`: shared package boundaries
- `packages/conway-core/AGENTS.md`: Conway grid logic constraints
- `packages/rts-engine/AGENTS.md`: RTS room/team/economy invariants
- `tests/AGENTS.md`: placement rules for cross-runtime and end-to-end suites
- `tests/integration/AGENTS.md`: stricter integration-specific test rules

When editing a file, follow the nearest AGENTS.md plus this root file.

## Cross-Cutting Rules

- Keep imports directional:
  - `apps/*` can import from `packages/*`
  - `packages/*` must not import from `apps/*`
- Keep reusable deterministic logic in `packages/*`
- Keep runtime bootstrapping and socket lifecycle in `apps/*`

## Test Policy

These rules apply to every `*.test.ts` and `*.spec.ts` file in the repo.

- Use Vitest.
- Keep test names explicit about the scenario and expected outcome.
- Verify observable behavior (public APIs, emitted events, payloads, and state effects), not private internals.
- Prefer helper functions with bounded retries/timeouts over fixed sleeps or timing-sensitive assumptions.
- Always tear down sockets, servers, and other long-lived resources in tests.
- Use ephemeral ports (`port: 0`) for runtime/integration tests.
- Keep deterministic package/unit tests co-located with their source package when practical.
- Keep cross-runtime, cross-layer, and end-to-end behavior checks under `tests/`.

Nested `AGENTS.md` files should only add test guidance when a subtree needs stricter rules than this baseline.

## Module Entry Points / Aliases

- Prefer importing shared package APIs via Node `package.json` `imports` aliases:
  - `#conway-core`
  - `#rts-engine`
- Package entry points live at `packages/*/index.ts` and are compiled into `dist/packages/*/index.js` for runtime use.

## Build / Test Commands

```bash
npm run dev
npm run dev:server
npm run build
npm run build:server
npm run preview
npm run start

npm test
npm run test:unit
npm run test:integration
npm run test:integration:serial
npm run test:quality
npm run test:watch

npm run format
npm run format:check

npm run lint
npm run lint:fix
```

## Baseline TypeScript / Style Expectations

- TypeScript strict mode; avoid `any`
- Use explicit `.js` extensions in relative imports
- Prefer explicit return types for exported functions
- Use interfaces for object shapes (type aliases are fine for unions)
- Validate network payloads at runtime boundaries
- Keep `npm run lint` passing (ESLint + `typescript-eslint` `recommendedTypeChecked`)

## General Practices

- After making a phase of changes, commit them.
- Use Conventional Commits style of commits.
