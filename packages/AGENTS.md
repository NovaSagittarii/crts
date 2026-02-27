# Packages Layer Guidelines

These rules apply to `packages/*`.

## Purpose

- `packages/*` contains deterministic, reusable domain logic shared across runtimes.

## Rules

- Keep packages runtime-agnostic: no Express, Socket.IO server/client, or DOM APIs.
- Prefer pure functions and explicit state transitions.
- Keep imports directional:
  - packages may import from other packages
  - packages must not import from `apps/*`
- Expose typed, stable APIs for runtime layers.
- Co-locate unit tests in each package under `test/`.
