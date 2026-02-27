# Integration Test Guidelines

These rules apply to `tests/integration/*`.

## Purpose

- Validate behavior across runtime boundaries (Socket.IO server + client interaction).

## Rules

- Use ephemeral ports (`port: 0`) for isolation.
- Prefer helper functions for waiting on events/conditions with bounded retries.
- Keep assertions focused on externally visible contract and state payloads.
- Ensure teardown always runs: close clients, then stop server.
- Keep integration scenarios deterministic; avoid timing-sensitive assumptions.
