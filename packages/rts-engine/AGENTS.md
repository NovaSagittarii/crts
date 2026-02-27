# RTS Engine Package Guidelines

These rules apply to `packages/rts-engine/*`.

## Purpose

- Model rooms, teams, structures, queued build events, economy, and defeat logic.

## Invariants

- Defeat condition is base integrity breach (team 2x2 base no longer intact).
- Queue validation must reject invalid player/team/template/payload/bounds/territory cases.
- Build delay is clamped to the configured range.
- Tick order stays deterministic:
  1. process team economy and due queued events
  2. apply accepted templates
  3. apply legacy cell updates
  4. step Conway grid
  5. evaluate base integrity defeat

## Rules

- Keep this package free of Socket.IO, Express, and DOM concerns.
- Keep room payload builders stable and explicitly typed.
- Prefer deterministic behavior over convenience randomness.
- Add/adjust unit tests for every rule change in room/team/economy logic.
