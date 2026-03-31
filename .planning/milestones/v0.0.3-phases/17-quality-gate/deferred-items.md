# Deferred Items - Phase 17

## Pre-existing Bug: ClientSimulation.applyQueuedBuild reservedCost Mismatch

**Discovered during:** Plan 01, Task 1
**File:** `apps/web/src/client-simulation.ts` line 134
**Issue:** `applyQueuedBuild()` computes `reservedCost` as `template?.activationCost ?? 0`, but the server computes it as `diffCells + activationCost` (line 2784 of rts.ts). For a 'block' template (2x2 = 4 alive cells, activationCost 0), the server reserves 4 resources but the client reserves 0. This causes economy divergence when builds are applied via `applyQueuedBuild` (the live build:queued path), though it does not affect reconnection (which uses `fromPayload` with correct embedded reservedCost).
**Impact:** Hash divergence on builds applied during live match via lockstep input relay
**Recommended fix:** Either include `reservedCost` in `BuildQueuedPayload` (server sends it), or compute `diffCells` on the client side matching the server logic.
