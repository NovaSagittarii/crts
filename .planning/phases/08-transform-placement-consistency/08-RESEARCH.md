# Phase 8: Transform Placement Consistency - Research

**Researched:** 2026-03-02
**Domain:** Transform-aware build placement (preview -> queue -> simulation parity)
**Confidence:** MEDIUM

<user_constraints>

## User Constraints (from CONTEXT.md)

### Locked Decisions

### Transform controls and state model

- Rotation uses a single cycle control: `0deg -> 90deg -> 180deg -> 270deg -> 0deg`.
- Mirroring uses separate controls for horizontal and vertical mirror.
- Combined transforms are order-sensitive: final shape follows the exact user press sequence.
- Transform state persists until manually changed (it does not auto-reset after queue attempts or successes).
- Transform state should be representable as a composable transform matrix so multiple transforms can be encoded/applied efficiently across systems.

### Preview visualization and legality feedback

- Preview renders the full occupied-cell footprint and also shows a bounding box.
- Preview communicates validity with short reason labels (not color-only).
- When only part of the footprint is illegal, illegal cells render in red while legal cells keep normal preview coloring.
- Map edge crossing is legal under torus wrapping behavior.
- A transformed placement is invalid only when the template exceeds map-size constraints (not simply because it crosses an edge).

### Queue outcomes and build-mode interaction

- Successful queue attempts show a small non-blocking confirmation and update queue panel state.
- Rejected queue attempts use the same short reason taxonomy as preview feedback.
- After rejection, keep preview anchor and transform so the player can adjust quickly.
- After acceptance, keep preview active and keep transform persisted for repeated placements.
- Add an explicit "Cancel Build Mode" button so players can exit placement mode deliberately.

### Parity and authoritative reconciliation

- Symmetric/no-op transforms still update transform state and show explicit transform indicators.
- If preview appears valid locally but server rejects (state changed), show the authoritative reject reason and immediately refresh preview legality.
- Queue action is disabled when preview is invalid, with reason visible.
- "Template exceeds map size" is an explicit invalid reason and blocks queueing.

### OpenCode's Discretion

- Exact control placement and visual styling for rotate/mirror actions, transform indicators, and confirmation UI.
- Exact wording/iconography for reason labels, as long as preview and reject messages remain taxonomy-consistent.
- Internal transform representation details (for example, matrix caching strategy) as long as user-facing order-sensitive semantics remain correct.

### Deferred Ideas (OUT OF SCOPE)

None — discussion stayed within phase scope.
</user_constraints>

<phase_requirements>

## Phase Requirements

| ID       | Description                                                                                                                                       | Research Support                                                                                                                                                                                     |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| XFORM-01 | Player can rotate a structure template before preview/queue placement.                                                                            | Add a shared transform model in engine (`matrix + ordered ops`) and extend `build:preview`/`build:queue` payloads so rotation is part of authoritative validation and apply paths.                   |
| XFORM-02 | Player can mirror a structure template before preview/queue placement.                                                                            | Add horizontal + vertical mirror operations to the same shared transform model, with order-preserving semantics carried from UI to engine.                                                           |
| QUAL-03  | Player sees consistent placement legality between preview, queued result, and applied simulation outcome for standard and transformed placements. | Keep preview and queue on one validation pipeline, return identical reason taxonomy, and persist accepted transform metadata so integrity checks and applied footprints match previewed orientation. |

</phase_requirements>

## Summary

Phase 8 is primarily a consistency problem, not a control-only UI problem. The current implementation is axis-aligned: build payloads only carry `templateId/x/y`, preview payloads only return affordability + reason, and structure instances only persist untransformed template identity at an anchor. This means rotate/mirror cannot be bolted on in the client alone without creating drift.

The highest-risk gaps are already visible in current code: placement legality is still rectangular/in-bounds (`inBounds`), preview rendering in web is bounding-box only, and integrity checks replay untransformed template cells against the world grid. If transformed placements are accepted without storing transform metadata, post-apply integrity checks will become incorrect.

Implement this phase by introducing one canonical transform pipeline in `packages/rts-engine`, then consuming it everywhere: preview legality, queue acceptance, resolve-time revalidation, template application, and structure integrity checks. Keep server authoritative and make the client render server-projected legality/footprint data.

**Primary recommendation:** Build a shared transform + wrapped-footprint engine utility first, and make preview/queue/apply/integrity all call that same path before adding UI controls.

## Standard Stack

### Core

| Library                           | Version           | Purpose                                                                       | Why Standard                                                                                                        |
| --------------------------------- | ----------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `#rts-engine` (workspace package) | repo-local        | Authoritative build validation, queueing, and simulation apply                | Existing single source of truth for deterministic gameplay logic (`queueBuildEvent`, `tickRoom`).                   |
| `socket.io` + `socket.io-client`  | `4.7.5` + `4.8.3` | Transport for `build:preview`, `build:queue`, `build:queued`, `build:outcome` | Existing contract path for placement lifecycle; phase should extend typed payloads rather than invent new channels. |
| `typescript`                      | `5.4.5`           | Strict shared typing across engine/server/web contracts                       | Required to evolve payloads and transform state safely across layers.                                               |
| `vitest`                          | `1.6.0`           | Unit + integration regression gates                                           | Existing deterministic tests already cover queue legality/outcome behavior and should be extended for transforms.   |

### Supporting

| Library                     | Version               | Purpose                                                         | When to Use                                                                                     |
| --------------------------- | --------------------- | --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Canvas 2D + Pointer Events  | browser baseline      | Render transformed placement preview footprint + bounding box   | Keep current rendering/input stack in `apps/web` for this phase; no framework migration needed. |
| `structuredClone`           | Node runtime built-in | Probe preview legality from cloned room state in server runtime | Continue for preview probes unless validation extraction removes clone dependency.              |
| `#conway-core` (`stepGrid`) | repo-local            | Existing torus semantics reference                              | Use as topology reference when implementing wrapped placement footprint behavior.               |

### Alternatives Considered

| Instead of                                         | Could Use                                                               | Tradeoff                                                                                                                         |
| -------------------------------------------------- | ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Matrix + ordered operation history                 | Canonicalized flags only (`rotationQuarterTurns`, `mirrorX`, `mirrorY`) | Flags are simpler for wire payloads but lose explicit no-op/order indicator semantics required by context decisions.             |
| Returning transformed footprint in `build:preview` | Expanding `RoomJoinedPayload.templates` with full cell masks            | Joined payload expansion enables local rendering before preview responses but increases initial payload size and contract scope. |
| String-based rejection mapping in server runtime   | Typed reason passthrough from engine (`BuildRejectionReason`)           | Typed passthrough needs light refactor but avoids fragile error-string switch logic.                                             |

**Installation:**

```bash
# No new dependency is required for baseline Phase 8 implementation.
npm install
```

## Architecture Patterns

### Recommended Project Structure

```
packages/rts-engine/
├── placement-transform.ts   # NEW: transform state, composition, footprint projection
├── rts.ts                   # Integrate transformed legality/apply/integrity paths
└── socket-contract.ts       # Extend build preview/queue payload contracts

apps/server/src/
└── server.ts                # Parse transform payloads; keep preview/queue reason parity

apps/web/
├── index.html               # Rotate/mirror/cancel controls + transform indicators
└── src/client.ts            # Persistent transform UI state and transformed preview rendering

tests/
├── integration/server/server.test.ts
├── integration/server/quality-gate-loop.test.ts
└── web/*.test.ts            # Optional extraction tests for transform UI state helpers
```

### Pattern 1: Canonical Transform Pipeline in Engine

**What:** Represent transform state once (composable matrix + ordered operations), and project transformed occupied cells from template-local space to world space.
**When to use:** Any code path that needs legality, affordability comparison, apply, or integrity checks for transformed templates.
**Example:**

```typescript
// Source: packages/rts-engine/rts.ts, packages/rts-engine/spawn.ts
const transformed = projectTemplate(template, transformState); // cells + transformed checks
const footprint = projectFootprintToWorld(
  transformed.cells,
  anchor,
  room.width,
  room.height,
); // wrapped coordinates

const illegalCells = footprint.filter((cell) => {
  return !isCoveredByUnionBuildZone(room, team, cell.x, cell.y);
});
```

### Pattern 2: Shared Preview/Queue Validator

**What:** Preview and queue use one validator entrypoint that returns normalized transform + legality + reason taxonomy.
**When to use:** `build:preview` and `build:queue` runtime handlers.
**Example:**

```typescript
// Source: apps/server/src/server.ts (current probe/queue split at lines ~1014-1033 and ~1451-1517)
const validation = validatePlacement(room.state, session.id, request);
if (!validation.ok) {
  return rejectWithReason(validation.reason, validation.metadata);
}

if (mode === 'preview') {
  return emitPreview(validation.preview);
}

return enqueueValidatedBuild(room.state, session.id, validation.normalized);
```

### Pattern 3: Torus-Wrapped Footprint with Size Guard

**What:** Crossing an edge is legal; only reject when transformed dimensions exceed map dimensions.
**When to use:** Before union-zone legality checks and before grid application.
**Example:**

```typescript
// Source: packages/conway-core/grid.ts (torus wrap precedent) and Phase 8 decisions
if (transformed.width > room.width || transformed.height > room.height) {
  return { ok: false, reason: 'template-exceeds-map-size' };
}

const wrappedX = ((rawX % room.width) + room.width) % room.width;
const wrappedY = ((rawY % room.height) + room.height) % room.height;
```

### Anti-Patterns to Avoid

- **Duplicating transform math across web/server/engine:** causes preview/queue/apply drift.
- **Using axis-aligned `inBounds` as legality gate for transformed placements:** violates torus edge-crossing decision.
- **Persisting structures without transform metadata:** breaks integrity checks and replay consistency for transformed builds.

## Don't Hand-Roll

| Problem                     | Don't Build                                                                | Use Instead                                                         | Why                                                                                      |
| --------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Transform composition       | Ad-hoc rotate/mirror branches in each layer                                | Shared engine transform utility (`placement-transform.ts`)          | Prevents cross-layer drift and makes order-sensitive semantics testable in one place.    |
| Preview/queue parity        | Separate legality logic for preview and queue paths                        | Single `validatePlacement` engine API used by both runtime handlers | Guarantees QUAL-03 consistency for accepted/rejected reasons and legality state.         |
| Reason taxonomy propagation | Error-string mapping switches (`mapQueueBuildErrorReason`) as primary path | Typed reason enums from engine through socket contracts             | Avoids brittle mapping bugs when adding new reasons (e.g., `template-exceeds-map-size`). |
| Footprint rendering         | Bounding-box-only preview inferred from width/height                       | Server-projected transformed occupied footprint + illegal-cell set  | Required for partial-illegal red cell rendering and accurate transformed previews.       |

**Key insight:** Transform placement consistency is a data-model problem first (shared transform + footprint representation), then a UI-control problem.

## Common Pitfalls

### Pitfall 1: Accepted transformed builds lose orientation in simulation checks

**What goes wrong:** Queue accepts a transformed placement, but integrity checks and future logic read untransformed template data.
**Why it happens:** `StructureInstance` currently stores `templateId/x/y` only and integrity uses `getStructureTemplate` + raw template coordinates.
**How to avoid:** Persist normalized transform metadata on queued events and stored structures; run integrity projection through transformed template cells/checks.
**Warning signs:** Freshly placed mirrored/rotated structures take unexpected integrity damage on the next tick.

### Pitfall 2: Torus expectations fail at map edges

**What goes wrong:** Preview rejects edge-crossing placements as out-of-bounds.
**Why it happens:** Current `inBounds(room, x, y, width, height)` gate rejects `x + width > room.width` and `y + height > room.height`.
**How to avoid:** Replace out-of-bounds gate with transformed-size guard + wrapped footprint projection.
**Warning signs:** Placement one cell from edge is rejected even when wrapped footprint would be valid.

### Pitfall 3: Preview says valid, queue rejects for different taxonomy/reason copy

**What goes wrong:** User sees inconsistent legality messaging between preview and queue attempts.
**Why it happens:** Runtime uses probe path + queue path with separate plumbing and fallback string mapping.
**How to avoid:** Return typed reasons from one validator and reuse same reason labels in preview + queue rejection UI.
**Warning signs:** `build:preview.reason` differs from immediate `room:error.reason` for identical payloads on stable state.

### Pitfall 4: Order-sensitive semantics are flattened away

**What goes wrong:** Controls appear to ignore user press sequence or no-op transforms are invisible.
**Why it happens:** State stores only canonical orientation flags, losing operation history for UI indicators.
**How to avoid:** Track ordered transform operations for indicator/state UX while also maintaining normalized matrix for engine logic.
**Warning signs:** Repeated mirror/rotate presses produce unchanged indicators despite context requiring explicit updates.

### Pitfall 5: Client cannot render full transformed footprint

**What goes wrong:** Preview still draws only bounding rectangle and cannot highlight partially illegal cells.
**Why it happens:** `StructureTemplateSummary` currently has no cell mask and `BuildPreviewPayload` has no footprint/illegal-cell data.
**How to avoid:** Extend contract with transformed footprint payload (or template cell masks) and render cells from authoritative data.
**Warning signs:** Preview UI cannot distinguish legal/illegal sub-cells for asymmetric templates.

## Code Examples

Verified patterns from current codebase:

### Full-footprint legality check baseline

```typescript
// Source: packages/rts-engine/rts.ts:614
for (let ty = 0; ty < template.height; ty += 1) {
  for (let tx = 0; tx < template.width; tx += 1) {
    const cellX = x + tx;
    const cellY = y + ty;
    let covered = false;

    for (const contributor of contributors) {
      if (isBuildZoneCoveredByContributor(contributor, cellX, cellY)) {
        covered = true;
        break;
      }
    }

    if (!covered) {
      return false;
    }
  }
}
```

### Preview currently probes the same engine queue validator

```typescript
// Source: apps/server/src/server.ts:1014 and apps/server/src/server.ts:1451
function runQueueBuildProbe(
  roomState: RoomState,
  playerId: string,
  payload: BuildQueuePayload,
): QueueBuildResult {
  const probeState = structuredClone(roomState) as RoomState;
  return queueBuildEvent(probeState, playerId, payload);
}

const previewResult = runQueueBuildProbe(
  room.state,
  session.id,
  previewRequest,
);
```

### Torus wrapping precedent in simulation

```typescript
// Source: packages/conway-core/grid.ts:67
const nx = (x + dx + width) % width;
const ny = (y + dy + height) % height;
neighbors += grid[ny * width + nx];
```

## State of the Art

| Old Approach                                          | Current Approach                                                               | When Changed   | Impact                                                                             |
| ----------------------------------------------------- | ------------------------------------------------------------------------------ | -------------- | ---------------------------------------------------------------------------------- |
| Axis-aligned build payload (`templateId`, `x`, `y`)   | Transform-aware payload carrying persistent transform state                    | Phase 8 target | Enables rotate/mirror controls before preview/queue with deterministic wire parity |
| Bounding-box-only preview from template dimensions    | Server-authoritative transformed footprint + illegal-cell projection           | Phase 8 target | Enables partial-illegal red-cell visualization and reason-aligned queue gating     |
| `inBounds` rejects edge crossing                      | Torus-wrapped footprint legality with explicit map-size constraint reason      | Phase 8 target | Aligns placement with torus gameplay expectations near edges                       |
| Structure stores only untransformed template identity | Structure persists normalized transform metadata used by apply/integrity paths | Phase 8 target | Prevents post-apply orientation drift and integrity mismatches                     |

**Deprecated/outdated:**

- `inBounds` as a hard legality blocker for all placements (`packages/rts-engine/rts.ts:542`) once torus edge-crossing is enabled.
- Bounding-box-only template preview in web render (`apps/web/src/client.ts:1265`) for transformed/asymmetric footprints.
- Error-string-first reason mapping (`apps/server/src/server.ts:956`) as the main source of rejection taxonomy.

## Open Questions

1. **Transform wire format should carry final matrix only or ordered operations too?**
   - What we know: User-visible semantics require order-sensitive behavior and no-op indicator updates.
   - What's unclear: Whether operation history must be transmitted to server or can remain UI-local metadata.
   - Recommendation: Transmit normalized transform (matrix or canonical enum) for authority; keep ordered op history client-side for indicator UX unless replay/debug requirements demand server persistence.

2. **Where should transformed footprint data live for rendering?**
   - What we know: Current `StructureTemplateSummary` lacks cell masks and preview payload lacks footprint cells.
   - What's unclear: Whether to add template masks to `room:joined` or include projected cells in each `build:preview` response.
   - Recommendation: Start with projected cells in `build:preview` (minimal blast radius); only expand `room:joined` if local pre-render without server round-trip becomes a UX requirement.

3. **Exact reason code name for map-size constraint**
   - What we know: Context requires explicit invalid reason text: "Template exceeds map size".
   - What's unclear: Canonical machine reason (for example `template-exceeds-map-size` vs `out-of-bounds-template`).
   - Recommendation: Add a dedicated `BuildRejectionReason` member `template-exceeds-map-size` and map UI copy directly from that code.

## Sources

### Primary (HIGH confidence)

- `packages/rts-engine/rts.ts` - Current queue validation order, `inBounds`, full-footprint legality, apply/integrity behavior, and structure persistence model.
- `packages/rts-engine/socket-contract.ts` - Current build preview/queue contract shape and missing transform fields.
- `apps/server/src/server.ts` - Runtime preview probe path, queue path, and reason mapping behavior.
- `apps/web/src/client.ts` - Current placement selection, preview handling, queue gating, and bounding-box-only preview rendering.
- `apps/web/index.html` - Current build controls and missing rotate/mirror/cancel controls.
- `tests/integration/server/server.test.ts` - Existing preview/queue contract assertions and placement fixture assumptions.
- `tests/integration/server/quality-gate-loop.test.ts` - Existing integration helper assumptions for in-bounds/full-footprint candidate generation.
- `packages/conway-core/grid.ts` - Existing torus wrapping precedent in simulation stepping.
- `package.json` - Current stack versions used for planning constraints.

### Secondary (MEDIUM confidence)

- `.planning/research/ARCHITECTURE.md` - Prior milestone-level architecture guidance on transform-aware contracts and shared validator pattern.
- `.planning/research/STACK.md` - Prior stack recommendations (used only as supporting context, not as authoritative runtime state).

### Tertiary (LOW confidence)

- None.

## Metadata

**Confidence breakdown:**

- Standard stack: HIGH - Versions and runtime tooling are directly verifiable in `package.json` and current scripts.
- Architecture: MEDIUM - Core gaps are clear, but final wire-format split (normalized transform vs operation history) is still a design choice.
- Pitfalls: HIGH - Each listed pitfall maps to concrete current code paths and known phase constraints.

**Research date:** 2026-03-02
**Valid until:** 2026-04-01
