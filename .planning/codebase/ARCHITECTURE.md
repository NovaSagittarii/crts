# Architecture

**Analysis Date:** 2026-02-27

## Pattern Overview

**Overall:** Layered, server-authoritative realtime architecture where runtime adapters live in `apps/*` and deterministic game rules live in `packages/*` (`apps/server/src/server.ts`, `apps/web/src/client.ts`, `packages/rts-engine/src/rts.ts`, `packages/conway-core/src/grid.ts`).

**Key Characteristics:**

- Keep Socket.IO/HTTP orchestration in `apps/server/src/server.ts` and browser orchestration in `apps/web/src/client.ts`; keep simulation/state transitions in `packages/rts-engine/src/rts.ts` and `packages/conway-core/src/grid.ts`.
- Treat room-scoped server state as the source of truth: state broadcasts originate in `apps/server/src/server.ts` and are consumed/rendered in `apps/web/src/client.ts`.
- Use explicit transition APIs (`queueBuildEvent`, `tickRoom`, `stepGrid`) in `packages/rts-engine/src/rts.ts` and `packages/conway-core/src/grid.ts` so tick behavior stays deterministic.

## Layers

**Web Client Layer:**

- Purpose: Render the game board/UI and send user intents to the server.
- Location: `apps/web/index.html`, `apps/web/src/client.ts`.
- Contains: DOM wiring, canvas rendering, pointer input handling, room/build controls, socket listeners/emitters.
- Depends on: `socket.io-client` and browser APIs in `apps/web/src/client.ts`.
- Used by: End users in the browser; receives server events defined in `apps/server/src/server.ts`.

**Server Runtime Layer:**

- Purpose: Host HTTP + Socket.IO runtime, manage room lifecycle, enforce server authority, and drive tick cadence.
- Location: `apps/server/src/server.ts`.
- Contains: Express static serving, socket event handlers, payload guards, room/session maps, periodic tick loop.
- Depends on: `packages/rts-engine/src/rts.ts` for room/team/build logic and `packages/conway-core/src/grid.ts` types.
- Used by: Browser clients from `apps/web/src/client.ts` and integration tests in `tests/integration/server/server.test.ts`.

**RTS Domain Layer:**

- Purpose: Model rooms, teams, templates, build queues, economy, and defeat rules.
- Location: `packages/rts-engine/src/rts.ts`.
- Contains: `RoomState` aggregate, template catalog, validation rules, queue processing, payload builders.
- Depends on: Grid primitives from `packages/conway-core/src/grid.ts`.
- Used by: Server runtime in `apps/server/src/server.ts`; unit tests in `packages/rts-engine/test/rts.test.ts`.

**Conway Simulation Layer:**

- Purpose: Provide reusable grid creation, mutation, stepping, and payload encoding primitives.
- Location: `packages/conway-core/src/grid.ts`.
- Contains: `createGrid`, `applyUpdates`, `stepGrid`, `encodeGridBase64`, `decodeGridBase64`.
- Depends on: Standard typed arrays and `Buffer` in `packages/conway-core/src/grid.ts`.
- Used by: `packages/rts-engine/src/rts.ts`, `tests/integration/server/server.test.ts`, `packages/conway-core/test/grid.test.ts`.

## Data Flow

**Realtime Room Simulation Flow:**

1. The client emits intent events (`cell:update`, `build:queue`, `room:*`) from `apps/web/src/client.ts`.
2. Socket handlers in `apps/server/src/server.ts` validate/sanitize payloads and map actions to engine calls such as `queueBuildEvent` and `queueLegacyCellUpdate` in `packages/rts-engine/src/rts.ts`.
3. The server tick loop (`setInterval`) in `apps/server/src/server.ts` calls `tickRoom` for each room state.
4. `tickRoom` in `packages/rts-engine/src/rts.ts` processes team economy and due build events, applies templates, applies legacy updates, steps Conway state via `stepGrid`, and marks defeated teams.
5. The server serializes room data through `createRoomStatePayload` in `packages/rts-engine/src/rts.ts` and emits `state` to room channels in `apps/server/src/server.ts`.
6. The client decodes base64 grid bytes and re-renders canvas/UI in `apps/web/src/client.ts`.

**State Management:**

- Keep authoritative mutable state in server memory (`rooms`, `sessions`) inside `apps/server/src/server.ts`; each room carries its domain aggregate as `RoomState` from `packages/rts-engine/src/rts.ts`.
- Keep client state view-model local to `apps/web/src/client.ts` (`gridBytes`, selected room/team/template); refresh it only from `room:joined` and `state` payloads.

## Key Abstractions

**`RoomState` Aggregate:**

- Purpose: Represent complete room simulation/runtime state (grid, players, teams, queue, counters).
- Examples: `packages/rts-engine/src/rts.ts`, runtime map storage in `apps/server/src/server.ts`.
- Pattern: Mutable aggregate updated only via exported transition functions (`addPlayerToRoom`, `queueBuildEvent`, `tickRoom`) in `packages/rts-engine/src/rts.ts`.

**`RoomStatePayload` Wire DTO:**

- Purpose: Provide a transport-safe snapshot for socket broadcasts.
- Examples: builder `createRoomStatePayload` in `packages/rts-engine/src/rts.ts`, emission usage in `apps/server/src/server.ts`, consumption in `apps/web/src/client.ts`.
- Pattern: Explicit serialization boundary (`Uint8Array` grid -> base64 string) before crossing runtime boundaries.

**`GameServer` Runtime Facade:**

- Purpose: Expose lifecycle methods for starting/stopping server runtime and querying default state.
- Examples: `GameServer` interface + `createServer` in `apps/server/src/server.ts`, usage in `tests/integration/server/server.test.ts`.
- Pattern: Factory returns a narrow API (`start`, `stop`, `getStatePayload`) while keeping internals private.

## Entry Points

**Server Process Entry:**

- Location: `apps/server/src/server.ts` (`if (import.meta.url === ...)`).
- Triggers: `npm run dev:server`, `npm run dev`, and `npm run start` from `package.json`.
- Responsibilities: Construct runtime with `createServer`, bind port, start tick loop, serve static assets.

**Server Programmatic Entry:**

- Location: `apps/server/src/server.ts` (`createServer`).
- Triggers: Integration tests in `tests/integration/server/server.test.ts`.
- Responsibilities: Provide deterministic lifecycle control for test orchestration.

**Web App Entry:**

- Location: `apps/web/index.html` loading module `apps/web/src/client.ts`.
- Triggers: Vite dev server (`npm run dev`) or built assets served by server runtime.
- Responsibilities: Mount UI shell, connect socket client, render and interact with room state.

## Error Handling

**Strategy:** Guard and reject at boundaries, then communicate failures through typed return values or socket error events (`apps/server/src/server.ts`, `packages/rts-engine/src/rts.ts`).

**Patterns:**

- Validate inbound event payload shape/value in `apps/server/src/server.ts` (`sanitizePlayerName`, `parseRoomId`, `parseCellUpdate`) before engine calls.
- Return explicit rejection metadata from domain layer (`QueueBuildResult`) in `packages/rts-engine/src/rts.ts`; map these to `room:error` in `apps/server/src/server.ts`.
- Ignore invalid/out-of-bounds low-level updates safely in `packages/conway-core/src/grid.ts` and `packages/rts-engine/src/rts.ts` instead of throwing.

## Cross-Cutting Concerns

**Logging:** Minimal process logging through `console.log` on server start in `apps/server/src/server.ts`.
**Validation:** Runtime payload guards in `apps/server/src/server.ts` plus domain invariants in `packages/rts-engine/src/rts.ts` and `packages/conway-core/src/grid.ts`.
**Authentication:** Not detected; identity is per-socket session ID with room/team association in `apps/server/src/server.ts`.

---

_Architecture analysis: 2026-02-27_
