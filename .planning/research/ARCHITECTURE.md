# Architecture Research

**Domain:** Conway RTS v0.0.2 gameplay expansion (deterministic multiplayer, server authoritative)
**Researched:** 2026-03-01
**Confidence:** HIGH for backend integration points and contracts; MEDIUM for exact frontend module split shape

## Standard Architecture

### System Overview

```text
┌───────────────────────────────────── Browser (apps/web) ─────────────────────────────────────┐
│  Lobby View  <->  Game View  <->  Overlay Layer (hover/details/build-zone/economy badges)    │
│         │                  │                     │                                              │
│         └────────────── UI Store (authoritative state + local camera/input state) ───────────┘
│                                            │                                                    │
│                                   Typed Socket Adapter                                          │
└────────────────────────────────────────────┬─────────────────────────────────────────────────────┘
                                             │
┌────────────────────────────────────────────┴─────────────────────────────────────────────────────┐
│                          Server Runtime (apps/server/src/server.ts)                              │
│  Socket handlers -> payload parsing -> lifecycle gate -> engine command APIs -> room broadcast   │
│                                            │                                                      │
│                                        Tick Loop                                                  │
└────────────────────────────────────────────┬─────────────────────────────────────────────────────┘
                                             │
┌────────────────────────────────────────────┴─────────────────────────────────────────────────────┐
│                         Deterministic Engine (packages/rts-engine)                               │
│  placement transforms | union build-zone checks | queue commands (build/destroy)                │
│  structure integrity + HP repair | base geometry | room payload projection                       │
└───────────────────────────────────────────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

| Component                                         | Responsibility                                                                                        | Typical Implementation                                               |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `packages/rts-engine` deterministic core          | Own build validation, transform normalization, queue execution, integrity/HP rules, base breach logic | Pure functions called from server tick and socket handlers           |
| `apps/server/src/server.ts` runtime orchestration | Own socket events, lifecycle gating (`lobby/countdown/active/finished`), room-scoped emissions        | Parse payload -> call package API -> emit `state` and outcome events |
| `packages/rts-engine/socket-contract.ts`          | Own wire-level TypeScript contracts for client/server/integration tests                               | Shared event interfaces and payload types                            |
| `apps/web` app state + rendering                  | Own view transitions, map camera (pan/zoom), overlay rendering, local input state                     | Split store/socket/render/view modules; no simulation logic          |
| `tests/integration/server/*`                      | Lock end-to-end event and lifecycle behavior                                                          | Socket-level contract tests with two clients and deterministic waits |

## Recommended Project Structure

```text
packages/rts-engine/
├── rts.ts                         # Existing orchestrator; keep as main tick entry
├── placement-transform.ts         # NEW: rotate/mirror normalization + transformed template projection
├── build-zone.ts                  # NEW: union-of-structure-radius predicates + overlay projection
├── structure-integrity.ts         # NEW: generic K-tick integrity check + HP repair resolution
├── structure-commands.ts          # NEW: build/destroy queue command union + deterministic ordering
├── socket-contract.ts             # Existing wire contracts; extend events/payloads
└── *.test.ts                      # Expand deterministic unit coverage before server/UI wiring

apps/server/src/
├── server.ts                      # Existing runtime; extend handlers and emissions
├── gameplay-payloads.ts           # NEW: transform + destroy payload parsing/validation helpers
└── lobby-session.ts               # Existing reconnect/session authority logic

apps/web/src/
├── client.ts                      # Convert to bootstrap only
├── app/store.ts                   # NEW: canonical client state + derived selectors
├── app/socket.ts                  # NEW: event bindings and dispatch bridge
├── views/lobby-view.ts            # NEW: lobby-focused DOM/render logic
├── views/game-view.ts             # NEW: in-match DOM/render logic
├── render/camera.ts               # NEW: pan/zoom transforms and world<->screen helpers
├── render/grid-renderer.ts        # NEW: grid canvas paint path
├── render/overlay-renderer.ts     # NEW: build-zone, structure hover, placement previews
├── features/placement-controls.ts # NEW: rotate/mirror controls + preview queue interactions
└── features/structure-actions.ts  # NEW: destroy action UX flow
```

### Structure Rationale

- **`placement-transform.ts` + `structure-commands.ts`:** keeps rotation/mirror and destroy changes out of `rts.ts` mega-function sprawl.
- **`build-zone.ts`:** isolates the new union-radius algorithm so queue validation, preview, and overlays share one implementation.
- **`gameplay-payloads.ts` on server:** avoids ad-hoc parsing branches inside an already large `server.ts`.
- **`app/store.ts` and dedicated render/view modules:** makes lobby/game transition and camera overlays testable without socket coupling.

## Architectural Patterns

### Pattern 1: Command Queue Union (Build + Destroy)

**What:** Keep one deterministic queue model with a command union instead of parallel ad-hoc queues.
**When to use:** Any gameplay mutation that changes structures/grid state (`build`, `destroy`).
**Trade-offs:** Slight refactor now, less long-term event-order ambiguity and less duplicate validation logic.

**Example:**

```typescript
type PlacementTransform = {
  rotationQuarterTurns: 0 | 1 | 2 | 3;
  mirrorX: boolean;
};

type QueuedCommand =
  | {
      kind: 'build';
      eventId: number;
      teamId: number;
      executeTick: number;
      templateId: string;
      x: number;
      y: number;
      transform: PlacementTransform;
    }
  | {
      kind: 'destroy';
      eventId: number;
      teamId: number;
      executeTick: number;
      structureId: string;
    };
```

### Pattern 2: Shared Validation Path for Preview and Queue

**What:** Preview and queue should call the same engine validator, not diverging code paths.
**When to use:** Build placement with transforms, destroy checks, affordability checks.
**Trade-offs:** Requires extracting validator API from `queueBuildEvent`; removes clone/probe drift risk.

**Example:**

```typescript
const preview = validateBuildCommand(room, teamId, payload);
if (!preview.ok) return reject(preview.reason);

const queued = queueValidatedBuildCommand(room, preview.normalized);
```

### Pattern 3: Server-Projected Structure Metadata for Grid-Attached UI

**What:** Server emits structure snapshots and build-zone sources; client only renders and interacts.
**When to use:** Hover details, destroy affordance, build-zone overlays, camera-aware annotations.
**Trade-offs:** Larger `state` payload; avoids client/server rules drift.

## Data Flow

### Flow A: Rotate/Mirror Build Path (Preview -> Queue -> Commit)

```text
[UI transform controls + board click]
    -> build:preview {templateId, x, y, rotationQuarterTurns, mirrorX}
    -> server payload parser + lifecycle gate
    -> engine validateBuildPlacement(...)
    -> build:preview response (affordability + rejection reason + normalized transform)
    -> build:queue (same payload)
    -> engine queue command
    -> tick executes command deterministically
    -> build:outcome + state broadcast
```

### Flow B: Destroy Structure End-to-End

```text
[Hover structure -> Destroy action]
    -> structure:destroy {structureId, delayTicks}
    -> server validates active state + ownership + not defeated
    -> engine queues destroy command
    -> tick resolves command (remove structure, recompute build-zone sources)
    -> structure:outcome + state broadcast
```

### Flow C: Generic Integrity + HP Repair Loop

```text
tickRoom
  1) apply economy + due queued commands
  2) apply grid mutations from accepted commands
  3) apply legacy updates (until removed)
  4) step Conway grid
  5) every K ticks: integrity checks for all structures with checks[]
     - failed check => hp--, then restore template if hp > 0
  6) evaluate defeat + match outcome
  7) project state payload
```

### Key Data Flows

1. **Transform propagation:** UI controls -> preview payload -> queued command -> outcome/state metadata.
2. **Build-zone propagation:** structure active/radius changes -> server build-zone source projection -> client overlay render.
3. **Destroy propagation:** hover-selected `structureId` -> queued destroy command -> state removal and outcome event.

## Integration Points

### New Artifacts (Create)

| Artifact                                                              | Layer  | Responsibility                                                                    | Depends On                            |
| --------------------------------------------------------------------- | ------ | --------------------------------------------------------------------------------- | ------------------------------------- |
| `packages/rts-engine/placement-transform.ts`                          | Engine | Deterministic rotate/mirror projection for cells/checks and normalized dimensions | Existing template model in `rts.ts`   |
| `packages/rts-engine/build-zone.ts`                                   | Engine | Union-of-structure-radius validation and overlay source projection                | Structure snapshots and active status |
| `packages/rts-engine/structure-integrity.ts`                          | Engine | Generic integrity check + HP repair (not core-only)                               | Tick order in `tickRoom`              |
| `packages/rts-engine/structure-commands.ts`                           | Engine | Build/destroy command queue model + deterministic sorting                         | Queue/event IDs in room state         |
| `apps/server/src/gameplay-payloads.ts`                                | Server | Parse and normalize transform/destroy payload fields                              | Socket contracts                      |
| `apps/web/src/render/camera.ts`                                       | Web    | Pan/zoom and world/screen conversion helpers                                      | Canvas render and pointer handlers    |
| `apps/web/src/render/overlay-renderer.ts`                             | Web    | Build-zone outlines, hover cards, placement footprints                            | State payload structure metadata      |
| `apps/web/src/views/lobby-view.ts`, `apps/web/src/views/game-view.ts` | Web    | Explicit lobby/game view transitions                                              | App store state machine               |

### Existing Artifacts (Modify)

| Artifact                                                                                           | Change Type          | Required Changes                                                                                                           |
| -------------------------------------------------------------------------------------------------- | -------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `packages/rts-engine/rts.ts`                                                                       | Modify               | Base shape constants/template, queue event model, structure ID strategy, new zone/integrity calls, destroy command support |
| `packages/rts-engine/socket-contract.ts`                                                           | Modify               | Extend build payloads with transform fields; add destroy events/payloads; extend state team payload for structures/zones   |
| `packages/rts-engine/index.ts`                                                                     | Modify               | Export newly extracted modules/types                                                                                       |
| `packages/rts-engine/rts.test.ts`                                                                  | Modify               | Add tests for transform validity, 5x5 base checks, union-zone checks, destroy command, deterministic same-tick ordering    |
| `apps/server/src/server.ts`                                                                        | Modify               | Wire new payload parsers, `structure:destroy` path, extended outcome emissions, updated reason mappings                    |
| `apps/web/src/client.ts`                                                                           | Modify (then shrink) | Migrate monolith logic into store/socket/render/view modules; keep bootstrap only                                          |
| `apps/web/index.html`                                                                              | Modify               | Add explicit lobby/game containers, map viewport wrapper, overlay layer anchors, transform/destroy controls                |
| `tests/integration/server/server.test.ts` and `tests/integration/server/quality-gate-loop.test.ts` | Modify               | Assert new wire contracts, destroy flow, transform-aware preview/queue/outcome, and no regressions in existing lifecycle   |

### Critical Data Contract Extensions

| Contract                     | Extension                                                                                                                   | Why                                                                              |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `BuildPreviewRequestPayload` | add `rotationQuarterTurns`, `mirrorX`                                                                                       | Preview must match final queued orientation/mirror                               |
| `BuildQueuePayload`          | add `rotationQuarterTurns`, `mirrorX`                                                                                       | Commit path must carry transform deterministically                               |
| `BuildPreviewPayload`        | echo normalized transform + transformed `width/height`                                                                      | Client preview box must match server-validated footprint                         |
| `BuildRejectionReason`       | add transform/destroy reasons (e.g. `invalid-transform`, `unknown-structure`, `cannot-destroy-core`, `structure-not-owned`) | Distinguish failure causes for UX and tests                                      |
| `RoomStatePayload.teams[]`   | add `structures[]` and `buildZoneSources[]` projections                                                                     | Needed for hover details, destroy targeting, and grid-attached overlay rendering |
| `ClientToServerEvents`       | add `structure:destroy`                                                                                                     | End-to-end destroy command                                                       |
| `ServerToClientEvents`       | add `structure:queued` and `structure:outcome`                                                                              | Destroy command lifecycle observability                                          |

### Cross-Layer Wiring Points and Failure-Prone Links

| Boundary                                     | Wiring Point                                                    | Failure Risk                                      | Mitigation                                                                           |
| -------------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Web input -> server preview                  | Transform payload (`rotationQuarterTurns`, `mirrorX`)           | UI preview mismatch versus server acceptance      | Normalize transform in server parser and echo normalized payload in preview response |
| Server preview -> engine queue               | Separate validation paths (`runQueueBuildProbe` clone vs queue) | Drift between preview and queue rejection reasons | Replace clone/probe with shared validator API in engine                              |
| Engine structure identity -> destroy payload | Reusing `x,y,width,height` key                                  | Collisions after rotations/mirrors and stale IDs  | Introduce stable monotonic `structureId` and project it in `state`                   |
| Engine zone math -> overlay renderer         | Client recomputes zone differently                              | Visual zone differs from authoritative validator  | Emit server-projected `buildZoneSources[]`; client renders only projection           |
| Camera math -> gameplay coordinates          | Pan/zoom + DPR pointer translation errors                       | Wrong cells queued/destroyed at non-default zoom  | Centralize world/screen conversion in `camera.ts` and unit test conversion           |
| Lifecycle gate -> destroy/build commands     | Missing status checks for new event                             | Mutations during lobby/countdown/finished         | Reuse `assertGameplayMutationAllowed` for all command handlers                       |

## Dependency-Aware Build Order (Backend + Tests First)

| Phase | Deliverable                                                                       | New vs Modified Artifacts                                                                          | Test Gate                                                          | Why This Order                                                |
| ----- | --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------- |
| 1     | Engine seam extraction (no behavior change)                                       | NEW `placement-transform.ts`, `build-zone.ts`, `structure-integrity.ts`; MOD `rts.ts` exports only | `npm run test:unit` unchanged behavior                             | Reduces risk before introducing new rules                     |
| 2     | Base geometry upgrade (5x5 / 16-cell core shape)                                  | MOD `rts.ts`, spawn geometry usage, payload base metadata                                          | New unit tests for base seed, integrity, defeat                    | Base shape drives later zone + destroy targeting              |
| 3     | Generic integrity + HP repair for all checked structures                          | MOD tick pipeline and structure model; NEW integrity helpers                                       | Unit tests for K-tick damage/repair determinism                    | Required before destroy and zone radius semantics settle      |
| 4     | Union build-zone validator (radius 15)                                            | MOD queue validation + preview validation; NEW zone projection                                     | Unit tests for inclusion/exclusion and deterministic ordering      | Queue/preview contract should stabilize before UI consumes it |
| 5     | Transform-aware build queue + preview contracts                                   | MOD `socket-contract.ts`, server parser, queue/build tests                                         | Integration tests for preview->queue->outcome parity               | Locks wire contracts before frontend refactor                 |
| 6     | Destroy command end-to-end                                                        | NEW destroy event/contracts + engine command path; MOD server handlers                             | Integration tests for ownership/core-protection/lifecycle lockouts | Completes backend feature set before UI implementation        |
| 7     | Frontend module split + lobby/game view state machine                             | NEW web modules, MOD `client.ts` to bootstrap                                                      | Existing web + integration tests must still pass                   | Avoid adding camera/overlay complexity to monolith            |
| 8     | UI gameplay features (pan/zoom, overlays, rotate/mirror controls, destroy action) | NEW camera/overlay/feature modules + MOD `index.html`                                              | Focused web tests + `npm run test:quality`                         | Final UX layer builds on stable backend contracts             |
| 9     | Regression hardening and requirement trace closure                                | MOD integration tests (`QUAL-01`, `QUAL-02` plus new req IDs)                                      | `npm run test:quality` green                                       | Prevents milestone drift and catches cross-layer regressions  |

## Anti-Patterns

### Anti-Pattern 1: Client-Side Rule Reimplementation

**What people do:** Recompute transform legality, zone union, or integrity status in browser logic.
**Why it is wrong:** Causes server/client divergence and false-positive UI affordances.
**Do this instead:** Keep server authoritative and render only server-projected previews/zones/outcomes.

### Anti-Pattern 2: Identity by Coordinates Only

**What people do:** Use `(x,y,width,height)` as persistent structure identity.
**Why it is wrong:** Rotations/mirrors and future template changes can collide or invalidate IDs.
**Do this instead:** Assign deterministic `structureId` on apply and use that ID across state/hover/destroy.

### Anti-Pattern 3: UI Refactor and Protocol Refactor in Same Slice

**What people do:** Refactor `apps/web/src/client.ts` while event payloads are still changing.
**Why it is wrong:** Creates cascading churn and hard-to-isolate regressions.
**Do this instead:** Freeze backend contracts first, then split UI modules against stable types.

## Scaling Considerations

| Scale                         | Architecture Adjustments                                                                            |
| ----------------------------- | --------------------------------------------------------------------------------------------------- |
| Prototype (current)           | Full `state` payload with structure projections is acceptable; prioritize deterministic correctness |
| Larger matches/maps           | Consider incremental structure/zone delta payloads to reduce `state` bandwidth                      |
| Multi-room concurrency growth | Keep deterministic engine pure and isolate server handler parsing to control hot-path complexity    |

## Sources

- Project scope and constraints: `.planning/PROJECT.md` (HIGH)
- Milestone rationale and gameplay intent: `conway-rts/DESIGN.md` (HIGH)
- Current deterministic engine implementation: `packages/rts-engine/rts.ts` (HIGH)
- Current wire contracts: `packages/rts-engine/socket-contract.ts` (HIGH)
- Current runtime wiring: `apps/server/src/server.ts` and `apps/server/src/lobby-session.ts` (HIGH)
- Current frontend architecture: `apps/web/src/client.ts`, `apps/web/src/economy-view-model.ts`, `apps/web/index.html` (HIGH)
- Current quality gate/integration behavior: `tests/integration/server/server.test.ts`, `tests/integration/server/match-lifecycle.test.ts`, `tests/integration/server/quality-gate-loop.test.ts` (HIGH)

---

_Architecture research for: Conway RTS v0.0.2 gameplay expansion_
_Researched: 2026-03-01_
