# Integration Test Guidelines

These rules apply to `tests/integration/*`.

## Purpose

- Validate behavior across runtime boundaries (Socket.IO server + client interaction).

## Additional Rules

- Keep assertions focused on externally visible contract and state payloads.
- Start from the shared fixture builders in `tests/integration/server/fixtures.ts`, `tests/integration/server/room-fixtures.ts`, `tests/integration/server/match-fixtures.ts`, and `tests/integration/server/lockstep-fixtures.ts` before adding bespoke setup/teardown helpers.
- Prefer `createIntegrationTest` for raw server harnesses, `createRoomTest` for connected-room suites, `createMatchTest` for active-match suites, and `createLockstepTest` for lockstep flows.
- Extend existing fixture builders when a new suite needs a slightly richer harness; keep socket tracking and server restart behavior centralized.
- Ensure teardown always runs: close clients, then stop server.
