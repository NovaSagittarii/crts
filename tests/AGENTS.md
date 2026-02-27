# Testing Guidelines

These rules apply to `tests/*`.

## Scope

- Keep cross-runtime and end-to-end behavior checks here.
- Prefer package-local unit tests in `packages/*/test` for deterministic logic.

## Rules

- Use Vitest and async helpers to avoid flaky socket timing assertions.
- Always close sockets/servers in tests to prevent resource leaks.
- Verify observable behavior (events/payload effects), not private internals.
- Keep test naming explicit about scenario and expected outcome.
