# Testing Patterns

**Analysis Date:** 2026-02-27

## Test Framework

**Runner:**

- Vitest `^1.6.0` (`package.json`).
- Config: `vitest.config.ts` (uses `globals: true`, `environment: 'node'`, and includes `packages/**/test/**/*.test.ts` plus `tests/**/*.test.ts`).

**Assertion Library:**

- Vitest built-in assertions via `expect` (`packages/conway-core/test/grid.test.ts`, `packages/rts-engine/test/rts.test.ts`, and `tests/integration/server/server.test.ts`).

**Run Commands:**

```bash
npm test                        # Run all tests (vitest run)
npm run test:watch              # Watch mode
Not configured in scripts       # Coverage command is not defined in package.json
```

## Test File Organization

**Location:**

- Keep deterministic unit tests co-located in package `test` folders (`packages/conway-core/test/grid.test.ts` and `packages/rts-engine/test/rts.test.ts`).
- Keep cross-runtime integration tests under `tests/integration` (`tests/integration/server/server.test.ts`).

**Naming:**

- Use `<subject>.test.ts` naming (for example `grid.test.ts`, `rts.test.ts`, and `server.test.ts`).

**Structure:**

```text
packages/
  conway-core/test/grid.test.ts
  rts-engine/test/rts.test.ts
tests/
  integration/server/server.test.ts
```

## Test Structure

**Suite Organization:**

```typescript
// from `packages/rts-engine/test/rts.test.ts`
describe('rts', () => {
  test('validates build queue payloads and delay clamping', () => {
    const room = createRoomState({
      id: '1',
      name: 'Alpha',
      width: 80,
      height: 80,
    });
    const team = addPlayerToRoom(room, 'p1', 'Alice');

    const outsideTerritory = queueBuildEvent(room, 'p1', {
      templateId: 'block',
      x: team.baseTopLeft.x + team.territoryRadius + 20,
      y: team.baseTopLeft.y + team.territoryRadius + 20,
    });

    expect(outsideTerritory.accepted).toBe(false);
  });
});
```

**Patterns:**

- Setup pattern: create fresh in-memory state/server per test (`createRoomState` in `packages/rts-engine/test/rts.test.ts`, `createServer` in `tests/integration/server/server.test.ts`).
- Teardown pattern: integration tests explicitly close clients and stop the server in each test (`tests/integration/server/server.test.ts`).
- Assertion pattern: verify concrete observable payload/state values, including arrays and encoded-grid effects (`packages/conway-core/test/grid.test.ts`, `packages/rts-engine/test/rts.test.ts`, and `tests/integration/server/server.test.ts`).

## Mocking

**Framework:** Not used (Vitest mocking APIs are available through Vitest, but no `vi.mock`/`vi.fn` usage is present in `packages/*/test/*.test.ts` or `tests/integration/server/server.test.ts`).

**Patterns:**

```typescript
// from `tests/integration/server/server.test.ts`
const server = createServer({ port: 0, width: 10, height: 10, tickMs: 40 });
const port = await server.start();
const socket = io(`http://localhost:${port}`, {
  autoConnect: false,
  transports: ['websocket'],
});
socket.connect();

// ...assert externally visible events/state...

socket.close();
await server.stop();
```

**What to Mock:**

- Not applicable to current tests; the project currently prefers real in-process modules and real Socket.IO connections (`packages/conway-core/test/grid.test.ts`, `packages/rts-engine/test/rts.test.ts`, `tests/integration/server/server.test.ts`).

**What NOT to Mock:**

- Do not mock package domain logic and room/tick rules in unit tests (`packages/conway-core/src/grid.ts`, `packages/rts-engine/src/rts.ts`).
- Do not mock Socket.IO event contracts in integration tests; assert actual emitted events/payloads (`apps/server/src/server.ts`, `tests/integration/server/server.test.ts`).

## Fixtures and Factories

**Test Data:**

```typescript
// from `packages/conway-core/test/grid.test.ts`
function setCells(
  grid: Uint8Array,
  width: number,
  cells: Cell[],
  alive: number,
): void {
  const updates: CellUpdate[] = cells.map(({ x, y }) => ({ x, y, alive }));
  applyUpdates(grid, updates, width, grid.length / width);
}
```

**Location:**

- Keep helper fixtures/builders local at the top of each test file (`setCells`/`hasCells` in `packages/conway-core/test/grid.test.ts`, `getCellAlive` in `packages/rts-engine/test/rts.test.ts`, and `waitForEvent`/`waitForCondition` in `tests/integration/server/server.test.ts`).

## Coverage

**Requirements:** None enforced (no coverage thresholds or coverage provider options configured in `vitest.config.ts`, and no coverage script in `package.json`).

**View Coverage:**

```bash
Not configured in repository scripts/config
```

## Test Types

**Unit Tests:**

- Focus on deterministic package behavior, including Conway evolution, encoding, room/team state transitions, queue validation, economy, and defeat rules (`packages/conway-core/test/grid.test.ts`, `packages/rts-engine/test/rts.test.ts`).

**Integration Tests:**

- Focus on runtime boundary behavior across real server/client sockets, including broadcast cadence, room lifecycle, build queuing, and team defeat (`tests/integration/server/server.test.ts`, exercising `apps/server/src/server.ts`).

**E2E Tests:**

- Not used (no browser automation framework or E2E suite detected in `/workspace`).

## Common Patterns

**Async Testing:**

```typescript
// from `tests/integration/server/server.test.ts`
async function waitForCondition(
  socket: Socket,
  predicate: (state: StatePayload) => boolean,
  attempts = 6,
): Promise<StatePayload> {
  for (let i = 0; i < attempts; i += 1) {
    const state = (await waitForEvent(socket, 'state')) as StatePayload;
    if (predicate(state)) return state;
  }
  throw new Error('Condition not met in allotted attempts');
}
```

**Error Testing:**

```typescript
// from `packages/rts-engine/test/rts.test.ts`
const afterDefeat = queueBuildEvent(room, 'p1', {
  templateId: 'block',
  x: base.x + 4,
  y: base.y + 4,
});
expect(afterDefeat.accepted).toBe(false);
expect(afterDefeat.error).toMatch(/defeated/i);
```

---

_Testing analysis: 2026-02-27_
