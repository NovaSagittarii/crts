# Web Test Guidelines

These rules apply to `tests/web/*`.

## Purpose

- Validate `apps/web` behavior in Vitest's Node environment without depending on a browser test runner.

## Additional Rules

- Import `apps/web` modules directly and prefer assertions against view-model, controller, layout, and sync-helper behavior.
- Avoid browser-only globals and DOM-heavy setup when a pure helper or small fake can cover the behavior.
- Keep assertions focused on observable state derivation, emitted request payloads, and render/layout decisions.
- If logic becomes reusable deterministic domain behavior, move it into `packages/*` and test it there instead of growing `tests/web/*`.
