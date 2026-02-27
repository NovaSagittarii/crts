# Conway Core Package Guidelines

These rules apply to `packages/conway-core/*`.

## Purpose

- Provide deterministic Conway grid logic and encoding helpers.

## Invariants

- Grid state is `Uint8Array` with `0` for dead and `1` for alive.
- `stepGrid` is a pure transition: it returns a new grid and does not mutate input.
- `applyUpdates` ignores invalid payload entries and out-of-bounds coordinates.
- Base64 encode/decode helpers must preserve bit-level fidelity.

## Rules

- Keep this package independent from RTS/team/socket concepts.
- Avoid runtime side effects and non-deterministic behavior.
- Maintain unit coverage for stable patterns (`block`) and moving patterns (`glider`).

## Testing

- Prefer co-located unit tests under `packages/conway-core` as `*.test.ts`.
