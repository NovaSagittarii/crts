# Apps Layer Guidelines

`apps/*` holds runtime-specific code. Keep runtime concerns here and keep deterministic reusable logic in `packages/*`.

## Scope

- Server bootstrap, socket lifecycle, and static serving in `apps/server`
- Browser UI, input handling, and socket client orchestration in `apps/web`

## Rules

- `apps/*` may import from `packages/*`
- Do not move reusable game logic into `apps/*`; place it in packages instead
- Keep payload validation at runtime boundaries

## Migration Notes

- Phase 3 completed: server runtime room orchestration should prefer `RtsRoom` instance methods over direct static `RtsEngine` room APIs.
- During migration windows, static room APIs remain compatibility shims in packages; new app-side room behavior should call the `RtsRoom` instance held by runtime room state.
