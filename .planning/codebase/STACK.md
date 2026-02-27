# Technology Stack

**Analysis Date:** 2026-02-27

## Languages

**Primary:**

- TypeScript 5.x (strict mode) - Runtime and shared logic in `apps/server/src/server.ts`, `apps/web/src/client.ts`, `packages/conway-core/src/grid.ts`, `packages/rts-engine/src/rts.ts`, and `tests/integration/server/server.test.ts`.

**Secondary:**

- HTML/CSS - Browser UI and styling in `apps/web/index.html`.
- JSON/JSONC config - Project and tooling config in `package.json`, `package-lock.json`, `tsconfig.json`, and `.devcontainer/devcontainer.json`.

## Runtime

**Environment:**

- Node.js (ES module project via `"type": "module"`) in `package.json`.
- Node.js 18+ is required by core toolchain dependencies (see `node_modules/vite`, `node_modules/vitest`, and `node_modules/tsx` engine constraints in `package-lock.json`).
- Dev container baseline uses Node 22 Alpine in `.devcontainer/Dockerfile`.

**Package Manager:**

- npm (script and dependency management in `package.json`).
- Lockfile: present (`package-lock.json`, lockfileVersion 3).

## Frameworks

**Core:**

- Express 4.x - HTTP server and static file hosting in `apps/server/src/server.ts` (dependency declared in `package.json`).
- Socket.IO 4.x - Real-time server/client transport in `apps/server/src/server.ts` and `apps/web/src/client.ts` (dependencies declared in `package.json`).

**Testing:**

- Vitest 1.x - Unit and integration test runner configured in `vitest.config.ts` and scripted in `package.json`.

**Build/Dev:**

- Vite 5.x - Web app dev server and build pipeline in `vite.config.ts` and `package.json`.
- TypeScript (`tsc`) - Server compilation via `build:server` in `package.json` using `tsconfig.server.json`.
- TSX - TypeScript runtime/watch for server development in `package.json`.
- concurrently - Parallel web/server local development process in `package.json`.

## Key Dependencies

**Critical:**

- `express` (`^4.19.2` declared, 4.22.1 locked) - Serves web assets and anchors the HTTP layer in `apps/server/src/server.ts`, `package.json`, and `package-lock.json`.
- `socket.io` (`^4.7.5` declared, 4.8.3 locked) - Server-side event transport and room broadcasts in `apps/server/src/server.ts`, `package.json`, and `package-lock.json`.
- `socket.io-client` (`^4.8.3` declared, 4.8.3 locked) - Browser socket client integration in `apps/web/src/client.ts`, `package.json`, and `package-lock.json`.

**Infrastructure:**

- `typescript` (`^5.4.5` declared, 5.9.3 locked) - Type checking and server emit in `package.json`, `package-lock.json`, and `tsconfig.server.json`.
- `vite` (`^5.2.0` declared, 5.4.21 locked) - Frontend bundling/dev server in `package.json`, `package-lock.json`, and `vite.config.ts`.
- `vitest` (`^1.6.0` declared, 1.6.1 locked) - Test execution in `package.json`, `package-lock.json`, and `vitest.config.ts`.
- `prettier` (`^3.3.3` declared, 3.8.1 locked) - Formatting standards in `package.json` and `prettier.config.mjs`.

## Configuration

**Environment:**

- Runtime port is configured by optional `PORT` env var in `apps/server/src/server.ts`; fallback is `3000` when unset.
- Game runtime knobs (`port`, `width`, `height`, `tickMs`) are passed through `createServer` options in `apps/server/src/server.ts`.
- `.env` files are not detected in repository scan under `/workspace`.

**Build:**

- TypeScript configs: `tsconfig.base.json`, `tsconfig.json`, `tsconfig.client.json`, and `tsconfig.server.json`.
- Frontend build config: `vite.config.ts`.
- Test config: `vitest.config.ts`.
- Formatting config: `prettier.config.mjs`.
- Containerized dev config: `.devcontainer/devcontainer.json`, `.devcontainer/Dockerfile`, and `.devcontainer/docker-compose.yml`.

## Platform Requirements

**Development:**

- Use Node.js 18+ with npm to satisfy Vite/Vitest/TSX engines (`package-lock.json`) and run scripts in `package.json`.
- Optional containerized workflow uses `.devcontainer/Dockerfile` and `.devcontainer/docker-compose.yml`.

**Production:**

- Deploy as a Node.js service running `node dist/apps/server/src/server.js` after `npm run build:server` and `npm run build` (`package.json`).
- Serve static client artifacts from `dist/client` and source fallback from `apps/web` through Express static middleware in `apps/server/src/server.ts`.

---

_Stack analysis: 2026-02-27_
