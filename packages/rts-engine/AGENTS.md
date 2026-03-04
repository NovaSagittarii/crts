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
- Follow `packages/AGENTS.md` migration policy for lobby APIs: allow at most one migration commit with temporary wrappers, then ship a dedicated sunset/retire commit that removes them.
- Preserve deterministic lobby semantics: host transfer by join order, slot contention and idempotent same-slot claims, readiness gating for assigned players, and stable rejection reasons/messages.

## Testing

- Prefer co-located unit tests under `packages/rts-engine` as `*.test.ts`.
- When lobby API shape changes, update both `packages/rts-engine/lobby.test.ts` and server integration lobby suites in `tests/integration/server`.
