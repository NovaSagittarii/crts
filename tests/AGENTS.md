# Testing Guidelines

These rules apply to `tests/*`.

## Scope

- Keep cross-runtime, cross-layer, and end-to-end behavior checks here (for example `tests/integration` and `tests/web`).
- Prefer package-local unit tests co-located under `packages/*` for deterministic logic.

## Rules

- Use Vitest; for socket/integration tests, use async helpers to avoid flaky timing assertions.
- Always close sockets/servers in tests to prevent resource leaks.
- Verify observable behavior (events/payload effects), not private internals.
- Keep test naming explicit about scenario and expected outcome.
