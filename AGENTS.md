# Agent Guidelines for CRTS

This is a TypeScript multiplayer Conway's Game of Life + RTS prototype using Socket.IO.

## Repository Structure

```text
apps/
  server/src/server.ts
  web/index.html
  web/src/client.ts

packages/
  conway-core/src/grid.ts
  conway-core/test/grid.test.ts
  rts-engine/src/rts.ts
  rts-engine/test/rts.test.ts

tests/
  integration/server/server.test.ts
```

## Nested AGENTS.md Layout

This repository uses nested AGENTS files for local rules.

- `apps/AGENTS.md`: runtime-layer rules shared by server/web
- `apps/server/AGENTS.md`: Socket.IO server runtime + event contract
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
- Keep reusable deterministic logic in `packages/*/src`
- Keep runtime bootstrapping and socket lifecycle in `apps/*`
- Co-locate unit tests with each package under `packages/*/test`
- Keep cross-runtime behavior tests in `tests/integration`

## Build / Test Commands

```bash
npm run dev
npm run dev:server
npm run build
npm run build:server
npm run start

npm test
npm run test:unit
npm run test:integration
npm run test:watch

npm run format
npm run format:check
```

## Baseline TypeScript / Style Expectations

- TypeScript strict mode; avoid `any`
- Use explicit `.js` extensions in relative imports
- Prefer explicit return types for exported functions
- Use interfaces for object shapes (type aliases are fine for unions)
- Validate network payloads at runtime boundaries
