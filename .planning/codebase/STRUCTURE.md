# Codebase Structure

**Analysis Date:** 2026-02-27

## Directory Layout

```text
[project-root]/
├── apps/                     # Runtime applications
│   ├── server/src/server.ts  # Node + Socket.IO server runtime entry
│   └── web/                  # Browser UI shell and client runtime
├── packages/                 # Shared deterministic game logic
│   ├── conway-core/src/grid.ts
│   └── rts-engine/src/rts.ts
├── tests/integration/        # Cross-runtime behavior tests
├── .planning/codebase/       # Generated mapper reference documents
├── .devcontainer/            # Development container setup
├── package.json              # Scripts and dependency declarations
├── tsconfig*.json            # TypeScript build targets
├── vite.config.ts            # Web build/dev config
└── vitest.config.ts          # Test runner config
```

## Directory Purposes

**apps/:**

- Purpose: Keep runtime-specific code for server and browser adapters.
- Contains: Socket/HTTP wiring in `apps/server/src/server.ts`, UI/event orchestration in `apps/web/src/client.ts`, and static shell in `apps/web/index.html`.
- Key files: `apps/server/src/server.ts`, `apps/web/src/client.ts`, `apps/web/index.html`, `apps/AGENTS.md`.

**packages/:**

- Purpose: Keep reusable deterministic domain logic shared by runtimes.
- Contains: Conway primitives in `packages/conway-core/src/grid.ts` and RTS room/team/build logic in `packages/rts-engine/src/rts.ts`.
- Key files: `packages/conway-core/src/grid.ts`, `packages/rts-engine/src/rts.ts`, `packages/AGENTS.md`.

**tests/:**

- Purpose: Keep cross-runtime integration verification at the top-level test layer.
- Contains: Socket-level behavior tests in `tests/integration/server/server.test.ts`.
- Key files: `tests/integration/server/server.test.ts`, `tests/AGENTS.md`, `tests/integration/AGENTS.md`.

**.planning/codebase/:**

- Purpose: Store generated architecture/quality/stack mapping documents for planner/executor workflows.
- Contains: Mapper outputs such as `ARCHITECTURE.md` and `STRUCTURE.md` in `.planning/codebase/`.
- Key files: `.planning/codebase/ARCHITECTURE.md`, `.planning/codebase/STRUCTURE.md`.

## Key File Locations

**Entry Points:**

- `apps/server/src/server.ts`: Server factory (`createServer`) and CLI startup branch (`import.meta.url` check).
- `apps/web/index.html`: Browser entry HTML that loads `apps/web/src/client.ts` as module.
- `apps/web/src/client.ts`: Client runtime bootstrap (DOM acquisition, socket connection, event bindings).

**Configuration:**

- `package.json`: Dev/build/test scripts and dependency graph.
- `tsconfig.base.json`: Shared strict TypeScript baseline.
- `tsconfig.server.json`: Server/package emit target to `dist/`.
- `tsconfig.client.json`: Web client compile target (`DOM` + bundler module resolution).
- `vite.config.ts`: Web root (`apps/web`) and output path (`dist/client`).
- `vitest.config.ts`: Unit + integration test discovery.
- `prettier.config.mjs`: Formatting rules enforced by `npm run format`/`format:check`.

**Core Logic:**

- `packages/conway-core/src/grid.ts`: Low-level grid state transitions + base64 serialization.
- `packages/rts-engine/src/rts.ts`: Room/team/template lifecycle, queue validation, tick processing, payload shaping.
- `apps/server/src/server.ts`: Room registry/session management + runtime tick orchestration.

**Testing:**

- `packages/conway-core/test/grid.test.ts`: Conway unit-level behavior.
- `packages/rts-engine/test/rts.test.ts`: RTS domain unit-level behavior.
- `tests/integration/server/server.test.ts`: End-to-end server/client event contract coverage.

## Naming Conventions

**Files:**

- Runtime and package source files use concise lowercase names (`server.ts`, `client.ts`, `grid.ts`, `rts.ts`) in `apps/*/src` and `packages/*/src`.
- Test files use `.test.ts` suffix colocated to scope (`packages/*/test/*.test.ts`, `tests/integration/**/*.test.ts`).
- Root tool configs use `*.config.ts` or `*.config.mjs` naming (`vite.config.ts`, `vitest.config.ts`, `prettier.config.mjs`).

**Directories:**

- Runtime directories are split by execution target (`apps/server`, `apps/web`).
- Shared logic directories use kebab-case package names under `packages/` (`packages/conway-core`, `packages/rts-engine`).
- Integration tests mirror runtime area in path segments (`tests/integration/server`).

## Where to Add New Code

**New Feature:**

- Primary code: Add runtime event wiring to `apps/server/src/server.ts`, deterministic rules to `packages/rts-engine/src/rts.ts` (or `packages/conway-core/src/grid.ts` for pure grid concerns), and UI triggers/rendering to `apps/web/src/client.ts`.
- Tests: Add domain tests in `packages/rts-engine/test/rts.test.ts` or `packages/conway-core/test/grid.test.ts`, plus cross-runtime coverage in `tests/integration/server/server.test.ts`.

**New Component/Module:**

- Implementation: Place browser-only UI behavior in `apps/web/src/` and server-only runtime behavior in `apps/server/src/`; place reusable deterministic logic in `packages/*/src/`.

**Utilities:**

- Shared helpers: Add pure reusable helpers under `packages/conway-core/src/` or `packages/rts-engine/src/` based on domain, then consume them from `apps/server/src/server.ts`.

## Special Directories

**`.devcontainer/`:**

- Purpose: VS Code/devcontainer runtime definition (`.devcontainer/devcontainer.json`).
- Generated: No.
- Committed: Yes.

**`.planning/codebase/`:**

- Purpose: Planner/executor reference docs generated by mapping workflows.
- Generated: Yes.
- Committed: Yes (when docs are intentionally tracked).

**`dist/`:**

- Purpose: Build output target from `tsconfig.server.json` and `vite.config.ts`.
- Generated: Yes.
- Committed: No (`dist/` is ignored in `.gitignore`).

---

_Structure analysis: 2026-02-27_
