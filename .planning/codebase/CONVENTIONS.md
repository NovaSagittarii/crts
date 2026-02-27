# Coding Conventions

**Analysis Date:** 2026-02-27

## Naming Patterns

**Files:**

- Use lowercase, domain-focused filenames for source modules (for example `packages/conway-core/src/grid.ts`, `packages/rts-engine/src/rts.ts`, `apps/server/src/server.ts`, and `apps/web/src/client.ts`).
- Use the `.test.ts` suffix for tests and keep integration tests under `tests/integration` (for example `packages/conway-core/test/grid.test.ts`, `packages/rts-engine/test/rts.test.ts`, and `tests/integration/server/server.test.ts`).

**Functions:**

- Use `lowerCamelCase` for function names and event handlers (for example `queueBuildEvent` in `packages/rts-engine/src/rts.ts`, `handleCellUpdate` in `apps/server/src/server.ts`, and `queueTemplateAt` in `apps/web/src/client.ts`).
- Keep explicit return types on exported functions and public helpers (for example `createServer(...): GameServer` in `apps/server/src/server.ts` and `stepGrid(...): Uint8Array` in `packages/conway-core/src/grid.ts`).

**Variables:**

- Use `camelCase` for local variables and mutable runtime state (for example `guestCounter` in `apps/server/src/server.ts` and `currentTeamId` in `apps/web/src/client.ts`).
- Use `UPPER_SNAKE_CASE` for module-level constants (for example `MAX_DELAY_TICKS` in `packages/rts-engine/src/rts.ts` and `DIST_CLIENT_DIR` in `apps/server/src/server.ts`).

**Types:**

- Use `PascalCase` `interface` names for payloads and domain state (for example `RoomState` in `packages/rts-engine/src/rts.ts`, `GameServer` in `apps/server/src/server.ts`, and `RoomJoinedPayload` in `apps/web/src/client.ts`).
- Use `type` aliases sparingly for simple aliases (for example `StatePayload` in `apps/server/src/server.ts`).

## Code Style

**Formatting:**

- Use Prettier as the formatting source of truth (`prettier.config.mjs`).
- Keep these active settings: `tabWidth: 2`, `useTabs: false`, `semi: true`, `singleQuote: true`, `jsxSingleQuote: true`, `trailingComma: 'all'`, and `arrowParens: 'always'` (`prettier.config.mjs`).
- Run format commands through `npm run format` and `npm run format:check` (`package.json`), and keep generated output excluded via `.prettierignore`.

**Linting:**

- Not detected: no ESLint or Biome config files are present (repo scan in `/workspace` for `.eslintrc*`, `eslint.config.*`, and `biome.json`).
- Use TypeScript strict mode as the static baseline (`tsconfig.base.json` sets `"strict": true`).

## Import Organization

**Order:**

1. Node built-ins first (for example `node:http` and `node:path` in `apps/server/src/server.ts`).
2. Third-party packages second (for example `express` and `socket.io` in `apps/server/src/server.ts`, and `socket.io-client` in `apps/web/src/client.ts`).
3. Internal project imports last, separated by a blank line (for example package imports in `apps/server/src/server.ts` and `tests/integration/server/server.test.ts`).

**Path Aliases:**

- Not used; imports are relative paths with explicit `.js` extensions (for example `../src/grid.js` in `packages/conway-core/test/grid.test.ts` and `../../../packages/rts-engine/src/rts.js` in `apps/server/src/server.ts`).

## Error Handling

**Patterns:**

- Validate `unknown` payloads at runtime boundaries before using typed fields (for example `parseCellUpdate`, `parseRoomId`, and `sanitizePlayerName` in `apps/server/src/server.ts`).
- Prefer guard clauses and early returns for invalid states (for example `queueBuildEvent` in `packages/rts-engine/src/rts.ts` and canvas/socket guards in `apps/web/src/client.ts`).
- Return booleans or typed status objects for expected validation failures (for example `QueueBuildResult` and boolean return helpers in `packages/rts-engine/src/rts.ts`).
- Throw `Error` for invariant breaches that should fail fast (for example `parseTemplateRows` in `packages/rts-engine/src/rts.ts` and `getRequiredElement` in `apps/web/src/client.ts`).

## Logging

**Framework:** `console` (`apps/server/src/server.ts`)

**Patterns:**

- Keep runtime logging minimal and operational; current logging is a startup message only (`apps/server/src/server.ts`).
- Keep tests assertion-driven without log-based verification (`packages/conway-core/test/grid.test.ts`, `packages/rts-engine/test/rts.test.ts`, and `tests/integration/server/server.test.ts`).

## Comments

**When to Comment:**

- Keep comments rare and rely on descriptive function/type names instead (`packages/conway-core/src/grid.ts`, `packages/rts-engine/src/rts.ts`, and `apps/server/src/server.ts`).
- Reserve comments for config/tooling notes when needed (for example `prettier.config.mjs`).

**JSDoc/TSDoc:**

- Not used in TypeScript source modules (`apps/server/src/server.ts`, `apps/web/src/client.ts`, `packages/conway-core/src/grid.ts`, and `packages/rts-engine/src/rts.ts`).

## Function Design

**Size:** No explicit size cap is enforced; prefer extracting deterministic helpers while allowing orchestrator functions where needed (for example helper-heavy `packages/rts-engine/src/rts.ts` and orchestration-focused `apps/server/src/server.ts`).

**Parameters:** Use typed object parameters for complex payloads/options and parse `unknown` inputs at network boundaries (for example `CreateRoomOptions` in `packages/rts-engine/src/rts.ts` and socket payload handlers in `apps/server/src/server.ts`).

**Return Values:** Prefer deterministic return values (`Uint8Array`, booleans, typed result objects) and explicit side-effect boundaries (for example `packages/conway-core/src/grid.ts` and `packages/rts-engine/src/rts.ts`).

## Module Design

**Exports:**

- Use named exports for runtime/domain modules (`packages/conway-core/src/grid.ts`, `packages/rts-engine/src/rts.ts`, and `apps/server/src/server.ts`).
- Reserve `export default` for tool configs (`vite.config.ts` and `vitest.config.ts`).

**Barrel Files:**

- Not used; import from direct module file paths (for example `../src/rts.js` in `packages/rts-engine/test/rts.test.ts` and `../../../apps/server/src/server.js` in `tests/integration/server/server.test.ts`).

---

_Convention analysis: 2026-02-27_
