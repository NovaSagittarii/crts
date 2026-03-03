# Packages Layer Guidelines

These rules apply to `packages/*`.

## Purpose

- `packages/*` contains deterministic, reusable domain logic shared across runtimes.

## Rules

- Keep packages runtime-agnostic: no Express, Socket.IO server/client, or DOM APIs.
- Prefer pure functions and explicit state transitions for stateless transforms and helpers.
- For stateful domain aggregates with tightly coupled invariants, prefer class-based APIs with deterministic methods.
- Avoid parallel functional and class APIs for the same behavior; migrate callsites and retire legacy surfaces in the same phase.
- Keep imports directional:
  - packages may import from other packages
  - packages must not import from `apps/*`
- Expose typed, stable APIs for runtime layers.

## Testing

- Prefer co-located unit tests next to source files in the package root as `*.test.ts`.
- Legacy unit tests may remain under `test/`.
