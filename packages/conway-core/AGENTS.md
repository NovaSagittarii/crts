# Conway Core Package Guidelines

These rules apply to `packages/conway-core/*`.

## Purpose

- Provide deterministic Conway grid logic and encoding helpers.

## Invariants

- `Grid` is the canonical Conway aggregate and owns dimensions, topology, and private byte-per-cell state.
- Grid cell values remain `0` (dead) and `1` (alive) with deterministic transitions.
- `Grid.step()` mutates in place according to Conway B3/S23 rules.
- Topology defaults to `torus`; `flat` topology is non-wrapping for reads/writes and neighbor checks.
- `Grid.toPacked()` and `Grid.fromPacked()` must preserve bit-level fidelity and bit ordering.

## Rules

- Keep this package independent from RTS/team/socket concepts.
- Keep Grid behavior in the class API; do not maintain parallel legacy function APIs for the same behavior.
- Avoid runtime side effects and non-deterministic behavior.
- Maintain unit coverage for stable patterns (`block`) and moving patterns (`glider`).

## Testing

- Prefer co-located unit tests under `packages/conway-core` as `*.test.ts`.
