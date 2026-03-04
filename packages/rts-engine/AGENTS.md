# RTS Engine Package Guidelines

These rules apply to `packages/rts-engine/*`.

## Purpose

- Model rooms, teams, structures, queued build events, economy, and defeat logic.

## Invariants

- Defeat condition is core health resolution reaching zero (core integrity checks can damage/restore HP before defeat).
- Queue validation must reject invalid player/team/template/payload/bounds/territory cases.
- Build delay is clamped to the configured range.
- Tick order stays deterministic:
  1. process team economy and due queued events
  2. apply accepted templates
  3. apply legacy cell updates
  4. step Conway grid
  5. resolve core integrity checks and mark defeated teams
  6. compute match outcome and drain pending queue entries as `match-finished` rejections when finished

## Rules

- Keep this package free of Socket.IO runtime wiring, Express, and DOM concerns (shared transport contract types are allowed).
- Keep room payload builders stable and explicitly typed.
- Prefer deterministic behavior over convenience randomness.
- Add/adjust unit tests for every rule change in room/team/economy logic.

## Lobby API Shape

- `LobbyRoom` is the canonical lobby aggregate API.
- Perform lobby mutations through instance methods (`join`, `claimSlot`, `setReady`, `leave`).
- Access lobby read models through `snapshot` and explicit accessors; do not mutate internal participant or slot containers from consumers.
- Do not maintain parallel functional wrapper APIs for lobby behavior once class migration is complete.
- Preserve deterministic lobby semantics: host transfer by join order, slot contention and idempotent same-slot claims, readiness gating for assigned players, and stable rejection reasons/messages.

## Testing

- Prefer co-located unit tests under `packages/rts-engine` as `*.test.ts`.
- When lobby API shape changes, update both `packages/rts-engine/lobby.test.ts` and server integration lobby suites in `tests/integration/server`.

## Migration Notes

- Phase 1 completed: core template layout/parsing utilities now live in `packages/rts-engine/core-template-layout.ts`.
- Keep `geometry.ts` independent from `RtsEngine`; canonical core footprint reads must come from `core-template-layout.ts`.
- Phase 2 completed: use `RtsRoom` as the preferred room-scoped API for callsites that own a single room instance.
- During migration, static `RtsEngine` room methods are compatibility wrappers; new room-local behavior should be added on `RtsRoom` first.
- Phase 4 completed: economy/queue/tick orchestration is split into deterministic private helpers (`processDue*`, `applyAcceptedBuildEvents`, `applyLegacyUpdatesAndAdvanceGeneration`, `resolveDefeatAndOutcome`).
- Preserve helper execution order to keep tick determinism and rejection/outcome semantics stable.
