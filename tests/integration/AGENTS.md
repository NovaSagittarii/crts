# Integration Test Guidelines

These rules apply to `tests/integration/*`.

## Purpose

- Validate behavior across runtime boundaries (Socket.IO server + client interaction).

## Additional Rules

- Keep assertions focused on externally visible contract and state payloads.
- Ensure teardown always runs: close clients, then stop server.
