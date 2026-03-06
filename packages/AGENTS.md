# Packages Layer Guidelines

These rules apply to `packages/*`.

## Purpose

- `packages/*` contains deterministic, reusable domain logic shared across runtimes.

## Rules

- Keep packages runtime-agnostic: no Express, Socket.IO server/client, or DOM APIs; do not import `socket.io` or `socket.io-client` from `packages/*`.
- Prefer pure functions and explicit state transitions for stateless transforms and helpers.
- For stateful domain aggregates with tightly coupled invariants, prefer class-based APIs with deterministic methods.
- For API migrations, allow temporary parallel surfaces for at most one migration commit, then follow with a dedicated sunset/retire commit that removes legacy surfaces.
- Keep imports directional:
  - packages may import from other packages
  - packages must not import from `apps/*`
- Expose typed, stable APIs for runtime layers.
