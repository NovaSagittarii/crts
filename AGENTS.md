# Agent Guidelines for CRTS (Conway's Game of Life)

This is a TypeScript project - a multiplayer Conway's Game of Life with Socket.IO.

## Project Structure

```
apps/
  server/src/server.ts            - Express + Socket.IO game server entry
  web/index.html                  - Client HTML entry
  web/src/client.ts               - Client Socket.IO app
packages/
  conway-core/src/grid.ts         - Core Conway grid logic
  rts-engine/src/rts.ts           - RTS rooms/teams/templates/economy logic
  conway-core/test/grid.test.ts   - Unit tests for grid logic
  rts-engine/test/rts.test.ts     - Unit tests for RTS engine logic
tests/
  integration/server/server.test.ts - Integration tests against live Socket.IO server
```

## Repository Collaboration Structure

This repo is organized by app/runtime boundary (`apps`) and reusable domain logic (`packages`) to reduce merge conflicts and keep ownership clear for multi-developer workflows.

### Collaboration Rules

- Put reusable, deterministic domain logic in `packages/*/src`.
- Put runtime concerns (socket lifecycle, static serving, app bootstrapping) in `apps/*`.
- Co-locate unit tests with the package they validate under `packages/*/test`.
- Keep end-to-end/socket behavior tests in `tests/integration`.
- Keep imports directional:
  - `apps/*` can import from `packages/*`.
  - `packages/*` should not import from `apps/*`.

### Why this shape

- Keeps PRs smaller by area (web, server runtime, core logic, RTS logic).
- Reduces accidental coupling between runtime code and core simulation logic.
- Makes CI targeting straightforward (`test:unit` vs `test:integration`).

## Build/Lint/Test Commands

### Running the Project

```bash
npm run dev          # Start dev server (Vite + tsx server)
npm run dev:server   # Start server only (tsx watch)
npm run build        # Build client (Vite)
npm run build:server # Build server (tsc -p tsconfig.server.json)
npm run start        # Run production server (node dist/apps/server/src/server.js)
npm run preview      # Preview production build
```

### Running Tests

```bash
npm test             # Run all tests once (vitest run)
npm run test:unit    # Run unit tests in packages/**/test
npm run test:integration # Run integration tests under tests/integration
npm run test:watch   # Run tests in watch mode (vitest)
```

**Run a single test file:**

```bash
npx vitest run tests/integration/server/server.test.ts
```

**Run a single test by name:**

```bash
npx vitest run -t "broadcasts generations"
```

### Code Formatting

```bash
npm run format       # Format all files (Prettier write)
npm run format:check # Check formatting without writing
```

## Code Style Guidelines

### General Principles

- Use TypeScript with strict mode enabled
- Prefer explicit typing over `any`
- Use functional patterns where possible (pure functions in `grid.ts`)
- Keep functions small and focused

### TypeScript

- **Target**: ES2022
- **Module system**: NodeNext (ES modules with `.js` extensions in imports)
- **Strict mode**: Enabled globally
- Always use explicit return types for exported functions
- Use interfaces for object shapes, not type aliases (except for unions)

### Naming Conventions

- **Files**: kebab-case (`grid.ts`, `server.test.ts`)
- **Functions**: camelCase (`createGrid`, `applyUpdates`)
- **Classes/Interfaces**: PascalCase (`GameServer`, `CellUpdate`)
- **Constants**: SCREAMING_SNAKE_CASE for config values, camelCase otherwise
- **Interfaces**: Use `Options` suffix for configuration interfaces (`ServerOptions`)
- **Interfaces**: Use `Payload` suffix for data transfer objects (`StatePayload`)

### Imports

- Use explicit extensions (`.js`) for relative imports
- Group imports: external libs → internal modules → types
- Use named exports and imports
- Example:

```typescript
import express, { Express } from 'express';
import { Server as SocketIOServer, Socket } from 'socket.io';

import { applyUpdates, createGrid } from './grid.js';
import type { CellUpdate } from './grid.js';
```

### Formatting (Prettier)

- Tab width: 2 spaces
- No tabs
- Semicolons: yes
- Single quotes: yes
- Trailing commas: all
- Arrow functions: always include parentheses

### Error Handling

- Validate inputs at function boundaries (see `applyUpdates` in `grid.ts`)
- Use early returns for invalid inputs
- Throw descriptive errors in test utilities
- For Socket.IO: validate payload types before processing (see `handleCellUpdate`)

### Testing

- Use Vitest with the `node` environment
- Unit tests: `packages/**/test/**/*.test.ts`
- Integration tests: `tests/**/*.test.ts`
- Use `describe` blocks for grouping
- Use `test` instead of `it` (vitest globals enabled)
- Clean up resources in `afterEach` or use `async/await` with cleanup
- Use helper functions for repeated test patterns

### Module Resolution

- Server code: `NodeNext` resolution
- Client code (`apps/web`): `bundler` resolution
- Prefer `process.cwd()` for repo-root asset paths in server runtime

### Notable Patterns

1. **Server factory pattern**: `createServer(options)` returns interface
2. **Grid encoding**: Base64 encoding of Uint8Array for transmission
3. **Tick-based game loop**: `setInterval` with configurable tickMs
4. **Pending updates queue**: Client updates batched until next tick

### Socket.IO Events

**Server emits:**

- `state`: Broadcasts current game state (`StatePayload`) to all clients

**Server receives:**

- `cell:update`: Receives cell updates from clients (`CellUpdatePayload`)

**Client workflow to server
2:**

1. Connect. Receive initial `state` event
2. Send `cell:update` events to modify cells
3. Receive updated `state` events on each tick

### Grid Mechanics

- Grid is stored as `Uint8Array` (0 = dead, 1 = alive)
- Conway's Game of Life rules applied in `stepGrid()`
- Grid is encoded to Base64 for network transmission via `encodeGridBase64()`
- Clients send individual cell updates; server batches them until next tick
- Grid coordinates are 0-indexed, validated against width/height bounds

### Client Code (`apps/web`)

- Uses Vite with `bundler` module resolution
- Can import from `socket.io-client`
- Lives in separate tsconfig (`tsconfig.client.json`)
- Built to `dist/client/` directory
