# Architecture Research

**Domain:** Conway RTS v0.0.3 template/grid cleanup integration
**Researched:** 2026-03-03
**Confidence:** HIGH

## Standard Architecture

### System Overview

```text
+----------------------------- Runtime Layer ------------------------------+
| apps/web/src/client.ts  <->  apps/server/src/server.ts                  |
| (input/render)                (socket parsing, lifecycle gate, emits)   |
+-----------------------------------+-------------------------------------+
                                    |
                                    v
+----------------------- Deterministic Domain Layer -----------------------+
| packages/rts-engine/rts.ts                                              |
|  - previewBuildPlacement / queueBuildEvent / tickRoom                   |
|  - projectStructures / integrity checks / payload projection             |
|                                                                          |
| NEW internal canonical path:                                             |
|   template.grid() -> GridView.applyTransform(...) -> translate(...)      |
|   -> cells() -> legality/apply/integrity/projection consumers            |
+-------------------+-------------------------+----------------------------+
                    |                         |
                    v                         v
      +-------------+-------------+   +-------+---------------------------+
      | grid-view.ts (NEW)        |   | placement-transform.ts (MOD)      |
      | immutable transformed view|   | normalize transform + wrap helper |
      +-------------+-------------+   +-------+---------------------------+
                    |                         |
                    +------------+------------+
                                 v
                      +----------+----------+
                      | conway-core/grid.ts |
                      | authoritative grid  |
                      | mutation/step/pack  |
                      +---------------------+
```

### Component Responsibilities

| Component                                          | Responsibility                                                         | Typical Implementation                                                                              |
| -------------------------------------------------- | ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `StructureTemplate` (`packages/rts-engine/rts.ts`) | Own template metadata and expose canonical `grid()` entrypoint         | Keep existing metadata (`id`, `name`, `width`, `height`, `cells`, `checks`) plus `grid(): GridView` |
| `GridView` (`packages/rts-engine/grid-view.ts`)    | Represent immutable transformed/translated template cells              | Chainable methods: `translate`, `rotate`, `applyTransform`, `cells()`                               |
| `placement-transform.ts`                           | Keep network-facing transform normalization and matrix state           | Reuse shared transform math; preserve existing `PlacementTransformState` contract                   |
| `rts.ts`                                           | Orchestrate queue validation, apply, integrity, and payload projection | Replace duplicate template-vs-offset loops with a single GridView pipeline                          |
| `apps/server/src/server.ts`                        | Runtime payload parsing and server authority                           | No wire-contract change required for this refactor                                                  |

## Recommended Project Structure

```text
packages/rts-engine/
├── rts.ts                      # MOD: adopt template.grid() + GridView pipeline
├── placement-transform.ts      # MOD: keep transform normalization; share matrix helpers
├── grid-view.ts                # NEW: GridView abstraction and cell iteration
├── grid-view.test.ts           # NEW: deterministic unit tests for GridView behavior
├── index.ts                    # MOD: export GridView APIs
└── *.test.ts                   # MOD: parity tests for preview/queue/apply/integrity

apps/server/src/
└── server.ts                   # NO REQUIRED CHANGE (payload contracts stay stable)

apps/web/src/
└── client.ts                   # NO REQUIRED CHANGE (consumes same preview/state payloads)

tests/integration/server/
├── quality-gate-loop.test.ts   # MOD: validate transformed-size assumptions via shared helpers
├── server.test.ts              # MOD (optional): extract duplicated placement helper
└── destroy-determinism.test.ts # MOD (optional): reuse extracted placement helper
```

### Structure Rationale

- **`grid-view.ts` is the only required new module:** this keeps scope focused on REF-01 through REF-04 without changing runtime boundaries.
- **`rts.ts` remains orchestrator-only:** transform/cell mechanics move behind `template.grid()` to reduce logic sprawl in placement, apply, and integrity paths.
- **Server/web stay stable:** no additional socket event fields are needed because this is an internal engine refactor.

## Architectural Patterns

### Pattern 1: Template Normalization at Room Boundary

**What:** Normalize templates once when constructing room state so every template has a canonical `grid()` API, including test-injected templates.
**When to use:** In `createRoomState` and `createDefaultTemplates` construction paths.
**Trade-offs:** Small setup overhead, much lower regression risk for custom template fixtures.

**Example:**

```typescript
interface StructureTemplate {
  id: string;
  name: string;
  width: number;
  height: number;
  cells: Uint8Array;
  checks: Vector2[];
  grid(): GridView;
}

function normalizeTemplate(
  template: StructureTemplateInput,
): StructureTemplate {
  const base = createGridView(template.width, template.height, template.cells);
  return {
    ...template,
    grid: () => base,
  };
}
```

### Pattern 2: Immutable GridView Transform Chain

**What:** Replace two-step template projection (`projectTemplateWithTransform` then `projectPlacementToWorld`) with one immutable chain.
**When to use:** Preview legality, queue validation, apply, integrity checks, and structure footprint projection.
**Trade-offs:** More short-lived objects; removes duplicated coordinate math and keeps behavior consistent.

**Example:**

```typescript
const normalized = normalizePlacementTransform(payload.transform);
const worldView = template
  .grid()
  .applyTransform(normalized.matrix)
  .translate(anchorX, anchorY);

for (const cell of worldView.cells()) {
  // cell: { x, y, alive }
}
```

### Pattern 3: Adapter-First Migration

**What:** Keep existing exported helper APIs during migration and implement them via GridView internally.
**When to use:** During phased rollout to avoid breaking tests and runtime contracts mid-milestone.
**Trade-offs:** Temporary duplication of type names, but lower regression blast radius.

**Example:**

```typescript
export function projectTemplateWithTransform(
  template: TransformTemplateInput,
  transform: PlacementTransformState,
): TransformedTemplate {
  return toTransformedTemplate(
    createGridView(
      template.width,
      template.height,
      template.cells,
    ).applyTransform(transform.matrix),
  );
}
```

## Data Flow

### Request Flow (Preview/Queue)

```text
[Web build click + transform state]
    -> apps/server parseBuildPayload
    -> previewBuildPlacement / queueBuildEvent (rts.ts)
    -> template.grid().applyTransform(...).translate(x, y)
    -> GridView.cells() (all cells with alive flag)
    -> partition data:
         - areaCells (all)
         - footprint (alive only)
         - bounds (derived extents)
    -> legality + affordability + apply pipeline
    -> existing build:preview / build:queued / build:outcome events
```

### Tick Flow (Deterministic)

```text
tickRoom
  1) applyTeamEconomyAndQueue (validation uses GridView)
  2) apply accepted builds (GridView-derived cell stream)
  3) apply legacy updates
  4) step Conway grid
  5) resolve integrity checks (same transformed cell basis)
  6) project payloads (footprints from same basis)
```

### Data-Flow Impact Summary

| Data Artifact                      | Current Producer                                                       | Recommended Producer                                                   | External Contract Impact |
| ---------------------------------- | ---------------------------------------------------------------------- | ---------------------------------------------------------------------- | ------------------------ |
| Build preview `footprint`/`bounds` | `projectTemplateWithTransform` + `projectPlacementToWorld` in `rts.ts` | `template.grid().applyTransform().translate().cells()` pipeline        | None                     |
| `compareTemplate` diff counting    | Nested loops over transformed array + bounds offsets                   | Iterate GridView cell stream directly                                  | None                     |
| `applyTemplate` writes             | Nested loops over transformed array + bounds offsets                   | Iterate GridView cell stream directly                                  | None                     |
| Integrity mask expected values     | Mix of transformed checks + occupied cells arrays                      | Same checks path, but cell expectations read from GridView coordinates | None                     |
| `StructurePayload.footprint`       | `projectTemplateWithTransform` + world projection                      | GridView pipeline filtered to alive cells                              | None                     |

## Integration Points

### New Components

| Component                               | Layer        | Responsibility                                         | Why New                                     |
| --------------------------------------- | ------------ | ------------------------------------------------------ | ------------------------------------------- |
| `packages/rts-engine/grid-view.ts`      | Engine       | Canonical immutable transformed grid abstraction       | Required by REF-01/REF-02/REF-03            |
| `packages/rts-engine/grid-view.test.ts` | Engine tests | Lock deterministic transform/translation/cell ordering | Prevent subtle regressions during migration |

### Modified Components

| Component                                            | Change Type | Required Change                                                                                     |
| ---------------------------------------------------- | ----------- | --------------------------------------------------------------------------------------------------- |
| `packages/rts-engine/rts.ts`                         | Modify      | Add `template.grid()` usage in placement projection, compare/apply, integrity, structure projection |
| `packages/rts-engine/placement-transform.ts`         | Modify      | Reuse shared transform math with GridView adapters; preserve existing exported transform types      |
| `packages/rts-engine/index.ts`                       | Modify      | Export GridView APIs for package consumers/tests                                                    |
| `packages/rts-engine/rts.test.ts`                    | Modify      | Add parity tests proving same outcomes for preview/queue/apply/integrity after refactor             |
| `packages/rts-engine/placement-transform.test.ts`    | Modify      | Assert adapter behavior remains backward-compatible                                                 |
| `tests/integration/server/quality-gate-loop.test.ts` | Modify      | Use shared transformed-size logic to avoid local transform drift                                    |

### Explicitly Unchanged Components

| Component                                | Why Keep Unchanged                                                              |
| ---------------------------------------- | ------------------------------------------------------------------------------- |
| `apps/server/src/server.ts`              | Build payload shape and result payload shape do not need schema changes         |
| `apps/web/src/client.ts`                 | Existing preview + state payloads remain stable; UI behavior should not regress |
| `packages/rts-engine/socket-contract.ts` | No new wire fields are required for this cleanup refactor                       |

### Internal Boundaries

| Boundary                             | Communication                                                     | Notes                                         |
| ------------------------------------ | ----------------------------------------------------------------- | --------------------------------------------- |
| `apps/server` -> `rts.ts`            | Existing queue/preview function calls                             | Keep server-authoritative flow unchanged      |
| `rts.ts` -> `grid-view.ts`           | Direct API calls (`grid`, `applyTransform`, `translate`, `cells`) | New canonical internal integration point      |
| `rts.ts` -> `placement-transform.ts` | Normalize wire transform and wrapping helpers                     | Keep existing transform payload compatibility |
| `rts.ts` -> `build-zone.ts`          | Pass extents/area cells from GridView output                      | Build-zone semantics unchanged                |

## Dependency-Aware Build Order (Low Regression Risk)

| Phase | Deliverable                                           | New vs Modified Components                                                                        | Test Gate                                                                 | Why This Order                                         |
| ----- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------ |
| 1     | GridView foundation (no runtime call-site changes)    | NEW `grid-view.ts`, NEW `grid-view.test.ts`                                                       | `npm run test:unit` with new GridView tests                               | Creates safe primitive before touching game logic      |
| 2     | Template normalization + `template.grid()` entrypoint | MOD `rts.ts` template construction (`createTemplateFromRows`, `createRoomState`)                  | Existing `rts.test.ts` template creation tests pass                       | Makes new API available without behavior changes       |
| 3     | Read-only projection migration                        | MOD `projectStructures`, `collectTeamBuildZoneContributors` in `rts.ts`                           | Snapshot/parity assertions for structure footprint and bounds             | Touches non-mutating paths first                       |
| 4     | Validation/apply migration                            | MOD `projectBuildPlacement`, `compareTemplate`, `applyTemplate` in `rts.ts`                       | Queue preview/outcome parity tests in `rts.test.ts` and integration tests | Highest gameplay risk after primitives are stable      |
| 5     | Integrity migration and duplicate path removal        | MOD `getIntegrityMaskCells`, mismatch restore flow; retire duplicate offset-template helpers      | Deterministic integrity tests and quality gates                           | Ensures one canonical transformed-cell path everywhere |
| 6     | Cleanup + optional low-risk simplification            | Optional extraction of template parsing helpers and duplicated integration test placement helpers | `npm run test:quality`                                                    | Finishes REF-04 and ships REF-05 candidate safely      |

**Phase ordering rationale:**

1. Introduce and verify the primitive first.
2. Expose the new template API without changing behavior.
3. Migrate read paths before write paths.
4. Migrate mutation paths only after parity confidence is high.
5. Remove old paths last, after deterministic tests prove equivalence.

## Anti-Patterns to Avoid

### Anti-Pattern 1: Partial Migration (Two Projection Pipelines)

**What people do:** Migrate preview to GridView but keep apply/integrity on old loops.
**Why it is wrong:** Preview/queue/apply can diverge despite passing unit tests.
**Do this instead:** Move all transformed-cell consumers to the same GridView chain before deleting old code.

### Anti-Pattern 2: `cells()` Returns Alive-Only Entries

**What people do:** Emit only occupied cells from GridView.
**Why it is wrong:** Breaks REF-03 and forces callers to reconstruct dead-space bounds.
**Do this instead:** Return all cells with `alive` flag and let consumers filter for footprint use cases.

### Anti-Pattern 3: Wrapping Coordinates Inside GridView Core

**What people do:** Bake torus wrapping directly into GridView transforms.
**Why it is wrong:** Hides map-size guard logic and couples reusable transforms to room dimensions.
**Do this instead:** Keep GridView in raw transformed coordinates; wrap at room projection boundaries.

## Scaling Considerations

| Scale                                             | Architecture Adjustments                                                             |
| ------------------------------------------------- | ------------------------------------------------------------------------------------ |
| 0-1k concurrent players (current prototype range) | Recompute GridView per preview/queue call; prioritize correctness                    |
| 1k-10k concurrent players                         | Cache transformed local views by `(templateId, transform.matrix)` before translation |
| 10k+ concurrent players                           | Precompute immutable transformed templates and reuse across room ticks               |

## Open Questions

1. Should `applyTransform` accept only orthogonal integer matrices, or any numeric matrix? Recommendation: restrict to orthogonal integer matrices this milestone to preserve grid determinism.
2. Should `StructureTemplate.grid` be required in public type immediately? Recommendation: normalize at room boundary first, then make it required after tests stop constructing raw literal templates.

## Sources

- `.planning/PROJECT.md` (HIGH)
- `packages/rts-engine/rts.ts` (HIGH)
- `packages/rts-engine/placement-transform.ts` (HIGH)
- `packages/rts-engine/placement-transform.test.ts` (HIGH)
- `packages/rts-engine/rts.test.ts` (HIGH)
- `apps/server/src/server.ts` (HIGH)
- `packages/rts-engine/socket-contract.ts` (HIGH)
- `tests/integration/server/quality-gate-loop.test.ts` (HIGH)
- `tests/integration/server/server.test.ts` and `tests/integration/server/destroy-determinism.test.ts` (HIGH)

---

_Architecture research for: Conway RTS v0.0.3 template/grid cleanup integration_
_Researched: 2026-03-03_
