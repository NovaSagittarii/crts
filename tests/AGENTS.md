# Testing Guidelines

These rules apply to `tests/*`.

## Scope

- Keep runtime-boundary and app-layer tests here when they do not belong beside a shared package source file.
- Use `tests/integration/*` for server/client contract checks, room lifecycle flows, reconnect behavior, and other cross-runtime assertions.
- Use `tests/web/*` for Node-run tests of `apps/web` view-models, controllers, render/layout helpers, and sync helpers.
- Keep deterministic shared package/unit coverage co-located under `packages/*` unless the test crosses runtime or app boundaries.
