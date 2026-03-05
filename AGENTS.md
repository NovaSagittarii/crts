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
- `tests/AGENTS.md`: global testing rules
- `tests/integration/AGENTS.md`: integration-test conventions

When editing a file, follow the nearest AGENTS.md plus this root file.

## Cross-Cutting Rules

- Keep imports directional:
  - `apps/*` can import from `packages/*`
  - `packages/*` must not import from `apps/*`
- Keep reusable deterministic logic in `packages/*`
- Keep runtime bootstrapping and socket lifecycle in `apps/*`
- For test placement and test-layer policy, follow `tests/AGENTS.md` (plus nested test AGENTS files).

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
