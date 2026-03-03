# Phase 15 Ambiguities

**Phase:** 15-read-path-and-cross-codebase-gridview-unification
**Updated:** 2026-03-03

## Resolved

### 1) Transformed-size helper source of truth in integration tests

- **Baseline source:** `tests/integration/server/quality-gate-loop.test.ts` local `estimateTransformedTemplateSize` used rotate-count parity only.
- **Chosen behavior:** Replace ad hoc math with shared `estimateTransformedTemplateBounds` from `packages/rts-engine/template-grid-read.ts`.
- **Reasoning:** Aligns cross-codebase helper behavior with canonical GridView matrix semantics and removes rotate-only drift risk.
- **Parity evidence:**
  - `npx vitest run tests/integration/server/server.test.ts -t "returns affordability preview payloads for valid build placements"`
  - `npx vitest run tests/integration/server/quality-gate-loop.test.ts -t "keeps transformed structure overlays stable across repeated reconnect loops"`
  - `npx vitest run tests/integration/server/destroy-determinism.test.ts -t "reconnects during pending destroy and converges on one authoritative terminal outcome"`
- **Status:** resolved

### 2) Reconnect overlay behavior during temporary team payload gaps

- **Baseline source:** `deriveTacticalOverlayState` rebuilt placeholder sections when `team === null`.
- **Chosen behavior:** Preserve last-known overlay sections while sync hint is visible, then resume normal projection when authoritative data returns.
- **Reasoning:** Matches phase requirement to avoid reconnect wobble and keep player context during short stale windows.
- **Parity evidence:**
  - `npx vitest run tests/web/tactical-overlay-view-model.test.ts -t "retains last-known overlay sections while reconnect sync is pending"`
- **Status:** resolved

### 3) Read-path helper ownership across structure/build-zone/integrity projections

- **Baseline source:** `packages/rts-engine/rts.ts` contained private helper forks for transform/world/integrity reads.
- **Chosen behavior:** Consolidate read-side geometry in `packages/rts-engine/template-grid-read.ts` and route `rts.ts` read consumers through that module.
- **Reasoning:** Satisfies REF-05 by eliminating duplicate read helper forks while preserving deterministic payload behavior.
- **Parity evidence:**
  - `npx vitest run packages/rts-engine/template-grid-read.test.ts`
  - `npx vitest run packages/rts-engine/rts.test.ts -t "keeps transformed structure payloads deterministic and fallback integrity masks active"`
- **Status:** resolved

## Allowlisted Follow-ups

- None.
