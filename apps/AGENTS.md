# Apps Layer Guidelines

`apps/*` holds runtime-specific code. Keep runtime concerns here and keep deterministic reusable logic in `packages/*`.

## Scope

- Server bootstrap, socket lifecycle, and static serving in `apps/server`
- Browser UI, input handling, and socket client orchestration in `apps/web`

## Rules

- `apps/*` may import from `packages/*`
- Do not move reusable game logic into `apps/*`; place it in packages instead
- Keep payload validation at runtime boundaries
