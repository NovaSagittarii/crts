# External Integrations

**Analysis Date:** 2026-02-27

## APIs & External Services

**Real-time Transport:**

- Socket.IO - Bidirectional event transport between browser clients and the game server (`apps/server/src/server.ts`, `apps/web/src/client.ts`).
  - SDK/Client: `socket.io` and `socket.io-client` in `package.json`.
  - Auth: No token/key-based auth detected in socket setup in `apps/server/src/server.ts`.

**Frontend Asset CDN:**

- Google Fonts - Remote font loading for UI typography in `apps/web/index.html`.
  - SDK/Client: Native browser `<link>` loading in `apps/web/index.html`.
  - Auth: None.

## Data Storage

**Databases:**

- In-memory state only (room maps, team state, grid bytes); no external database client detected in `apps/server/src/server.ts` and `packages/rts-engine/src/rts.ts`.
  - Connection: Not applicable (no DB env var usage detected in `apps/server/src/server.ts`).
  - Client: In-process `Map` and `Uint8Array` state management in `packages/rts-engine/src/rts.ts` and `packages/conway-core/src/grid.ts`.

**File Storage:**

- Local filesystem only for static assets served by Express from `dist/client` and `apps/web` in `apps/server/src/server.ts`.

**Caching:**

- None detected beyond process memory state in `apps/server/src/server.ts` and `packages/rts-engine/src/rts.ts`.

## Authentication & Identity

**Auth Provider:**

- Custom ephemeral session identity based on Socket.IO connection IDs (`socket.id`) in `apps/server/src/server.ts`.
  - Implementation: Player session map with sanitized display names; no persistent accounts/OAuth/JWT in `apps/server/src/server.ts`.

## Monitoring & Observability

**Error Tracking:**

- None detected (no Sentry/Bugsnag/Rollbar dependencies in `package.json`).

**Logs:**

- Console startup logging only (`console.log`) in `apps/server/src/server.ts`.

## CI/CD & Deployment

**Hosting:**

- Node.js process hosting an Express + Socket.IO server (`apps/server/src/server.ts`) launched via `npm run start` in `package.json`.

**CI Pipeline:**

- None detected under `.github/workflows/`.

## Environment Configuration

**Required env vars:**

- `PORT` (optional override; defaults to 3000) in `apps/server/src/server.ts`.

**Secrets location:**

- Not detected in tracked repository files; no `.env` files detected under `/workspace` and no secret config paths present in `.gitignore`.

## Webhooks & Callbacks

**Incoming:**

- None for HTTP webhooks; server exposes socket event handlers only in `apps/server/src/server.ts`.

**Outgoing:**

- No server-side webhook/API callback clients detected in `apps/server/src/server.ts`.
- Browser performs outgoing requests to Google Fonts endpoints in `apps/web/index.html`.

---

_Integration audit: 2026-02-27_
