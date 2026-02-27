# Feature Research

**Domain:** Browser multiplayer Conway RTS prototype (lobby/team setup + playable match loop)
**Researched:** 2026-02-27
**Confidence:** MEDIUM (HIGH for in-repo behavior, MEDIUM for broader feature expectations)

## Feature Landscape

### Table Stakes (Users Expect These)

Features users assume exist for a playable browser multiplayer strategy demo. Missing these makes the prototype feel broken, not minimal.

| Feature                                                                 | Why Expected                                                               | Complexity | Notes                                                                                                                                           |
| ----------------------------------------------------------------------- | -------------------------------------------------------------------------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Reliable room lifecycle (`room:list/create/join/leave`)                 | Players must reach the same match quickly, or no gameplay can be validated | MEDIUM     | Depends on server room channels and cleanup rules; TDD slice: integration tests around `room:joined`, `room:left`, and room list updates        |
| Deterministic team assignment + base spawn                              | Fair starts are mandatory in a head-to-head RTS loop                       | MEDIUM     | Depends on spawn selection and collision avoidance; add tests for spawn exhaustion/overlap behavior                                             |
| Server-authoritative tick + state sync                                  | Multiplayer Conway without authoritative ticks desyncs immediately         | MEDIUM     | Already present; keep as non-negotiable foundation; test cadence and room-scoped broadcasts                                                     |
| Core build loop (template queue, delay, validation, ack/error feedback) | Building is the primary player action in this design                       | HIGH       | Requires bounds + territory + affordability checks and clear rejection messages; TDD slice: `queueBuildEvent` matrix + socket integration paths |
| Economy visibility and spending loop                                    | Resource cost/income is needed for meaningful strategic choices            | MEDIUM     | Depends on structure integrity and per-tick income; expose resources/income in HUD and verify cost deductions in tests                          |
| Territory-constrained construction                                      | Prevents cross-map griefing and defines strategic space around each base   | MEDIUM     | Rule exists in engine; v1 needs at least clear textual/visual feedback when placement is outside territory                                      |
| Canonical breach/win condition with explicit end-state UX               | A match must end clearly (win/lose), not just continue after base failure  | MEDIUM     | Align one rule across docs + code (safe cell breach vs 2x2 base integrity); include defeated lockout + victory/defeat messaging                 |
| Minimal player identity feedback (name/team/base status)                | Multiplayer sessions require "who am I" and "what team am I" clarity       | LOW        | Session-level identity is enough for v1; no account system required                                                                             |

### Differentiators (Competitive Advantage)

Features that make this a Conway RTS (not just "multiplayer Life paint mode").

| Feature                                                  | Value Proposition                                                                                    | Complexity | Notes                                                                                              |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ---------- | -------------------------------------------------------------------------------------------------- |
| Ghost-cell batch planner with commit semantics           | Captures the design's core tactical idea: plan edits safely, then commit in one deterministic action | HIGH       | Best differentiator, but can be staged (single-batch v1.x before advanced multi-batch editor)      |
| Curated pattern deck (offense/defense/support templates) | Makes advanced Conway tactics accessible without requiring expert pattern memorization               | MEDIUM     | Start from `block/glider/eater/generator`, then expand toward DESIGN.md candidates                 |
| Territory-growth support structures                      | Adds macro-strategy (map control) on top of micro placement                                          | MEDIUM     | Leverages existing `buildArea`/income concepts; add UI cues before adding many new structures      |
| Tick-timeline UX (pending build queue visibility)        | Improves readability of delayed deterministic actions, reducing "why didn't it build?" confusion     | MEDIUM     | Server already returns `executeTick`; add queue panel before adding cancellation/advanced controls |
| Conway-specific threat signaling near safe cell          | Helps non-experts read attack trajectories and defend intentionally                                  | HIGH       | Defer deep forecasting; start with simple danger indicators tied to base-adjacent activity         |

### Anti-Features (Commonly Requested, Often Problematic)

Features that look attractive but are likely to derail v1 validation.

| Feature                                                            | Why Requested                                      | Why Problematic                                                                            | Alternative                                                    |
| ------------------------------------------------------------------ | -------------------------------------------------- | ------------------------------------------------------------------------------------------ | -------------------------------------------------------------- |
| Accounts, progression, ranked matchmaking                          | Players expect progression systems in online games | Adds auth, persistence, moderation, and non-gameplay complexity before core loop is proven | Session names + room-based play for v1                         |
| 4-10 player rooms/complex team systems                             | Social scale sounds more exciting                  | Amplifies spawn balancing, UI clutter, and performance risk before 1v1 is stable           | Lock v1 to 1v1 (optionally 2v2 later)                          |
| Huge maps + high-TPS optimization push (e.g., 2048x2048 ambitions) | "Epic scale" appeal                                | Forces transport/computation rewrites and obscures gameplay feedback quality               | Keep map sizes moderate and optimize after gameplay validation |
| Replay/spectator/time-travel tooling                               | Useful for sharing and debugging                   | Requires event logs, persistence, and replay UI architecture                               | Post-match summary + logs only                                 |
| Arbitrary user-uploaded templates/macros                           | Creative freedom appeal                            | Breaks balance and increases abuse/exploit surface early                                   | Curated template whitelist with controlled expansion           |
| Full fog-of-war + minimap + advanced camera suite                  | Familiar RTS feature request                       | Large UX/systems cost for a prototype currently built around direct grid visibility        | Keep full-map visibility for v1; revisit once core loop is fun |
| Stack rewrite (WASM/protobuf/C++ parity)                           | Performance and "production-ready" perception      | Conflicts with milestone goal of fast TypeScript iteration and gameplay learning           | Keep TypeScript + Socket.IO for this milestone                 |

## Feature Dependencies

```text
[Room lifecycle]
    └──requires──> [Team assignment + base spawn]
                         └──requires──> [Authoritative tick + state broadcast]
                                              └──requires──> [Build queue + template placement]
                                                                   └──requires──> [Economy spend/income]
                                                                                        └──requires──> [Breach win/lose + end-state UX]

[Template catalog] ──enhances──> [Build queue + template placement]
[Ghost-cell planner] ──enhances──> [Build queue + template placement]
[Territory-growth structures] ──enhances──> [Economy spend/income]

[Large-map performance hardening] ──conflicts──> [Fast v1 gameplay validation]
```

### Dependency Notes

- **Room lifecycle requires team/base assignment:** until room membership is deterministic, every downstream gameplay feature is noisy or untestable.
- **Build queue requires authoritative tick/state sync:** delayed template execution only works if all clients consume one server timeline.
- **Economy and breach rules should ship together:** players need immediate strategic feedback (resource pressure + win/loss) to evaluate loop quality.
- **Ghost planner should follow stable queue semantics:** implement planner UI only after queue acceptance/rejection semantics are reliable.

## MVP Definition

### Launch With (v1)

Minimum playable scope for milestone success.

- [ ] Room list/create/join/leave flow with clear room membership state
- [ ] 1v1 team spawn with deterministic base placement
- [ ] Template queue build loop (delay, validation, queued acknowledgment, rejection messaging)
- [ ] Resource/income HUD + territory enforcement in build validation
- [ ] Canonical breach victory/defeat loop with defeated-team action lockout
- [ ] End-to-end integration test path: join -> build -> tick -> breach -> defeat

### Add After Validation (v1.x)

Features that improve quality and strategic depth after v1 is stable.

- [ ] Ghost-cell planner (single-batch draft/commit) — add when base v1 queue feedback is stable
- [ ] Expanded template catalog from DESIGN.md shortlist — add when players can reliably execute core loop
- [ ] Queue inspector UI (pending events by execute tick) — add when build confusion appears in playtests
- [ ] Better execution-time failure signaling for queued builds — address known "accepted but not applied" confusion path

### Future Consideration (v2+)

Defer until core gameplay value is validated.

- [ ] Authentication, persistent profiles, and matchmaking services — defer due backend complexity
- [ ] Large-room scaling and transport optimization architecture — defer until measured load requires it
- [ ] Replay/spectator systems — defer until matches are strategically interesting enough to rewatch
- [ ] Multi-team diplomacy/high-player-count UX — defer until 1v1 balance is solved

## TDD-Friendly Slicing

1. **Lobby contract slice:** integration-test `room:list/create/join/leave` and `room:joined` payload completeness.
2. **Team/base slice:** unit-test spawn/base invariants, then integration-test two players in one room.
3. **Build validation slice:** unit-test bounds/territory/template/resource/defeated rejections for `queueBuildEvent`.
4. **Economy + execution slice:** unit-test queued build execution costs and dynamic income behavior over ticks.
5. **Match resolution slice:** unit + integration tests for breach detection, defeat lockout, and winner/loser UI events.
6. **Differentiator slice (post-v1):** add ghost planner as isolated client/server contract without changing core tick semantics.

## Feature Prioritization Matrix

| Feature                                   | User Value          | Implementation Cost | Priority |
| ----------------------------------------- | ------------------- | ------------------- | -------- |
| Room lifecycle + room visibility          | HIGH                | MEDIUM              | P1       |
| Deterministic team spawn + base ownership | HIGH                | MEDIUM              | P1       |
| Build queue + validation + feedback loop  | HIGH                | HIGH                | P1       |
| Economy HUD + spending clarity            | HIGH                | MEDIUM              | P1       |
| Breach win/lose + end-state UX            | HIGH                | MEDIUM              | P1       |
| Ghost-cell planner                        | HIGH                | HIGH                | P2       |
| Expanded pattern deck                     | MEDIUM              | MEDIUM              | P2       |
| Queue timeline inspector                  | MEDIUM              | MEDIUM              | P2       |
| Large-map optimization program            | MEDIUM              | HIGH                | P3       |
| Accounts/ranked matchmaking               | LOW (for prototype) | HIGH                | P3       |

**Priority key:**

- P1: Must have for launch
- P2: Should have after core validation
- P3: Intentional defer

## Competitor Feature Analysis

| Feature                           | Competitor A                                                                                                     | Competitor B                                                         | Our Approach                                            |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------- |
| Instant browser multiplayer entry | LittleWarGame emphasizes no-download/no-registration browser play (LOW-MEDIUM confidence from landing page only) | N/A for Life pattern sites                                           | Keep guest identity + direct room join as table stakes  |
| High-skill strategic vocabulary   | Traditional RTS uses unit tech trees                                                                             | Conway ecosystem uses canonical named patterns (gliders/eaters/guns) | Use curated Conway template deck as the learning bridge |

## Sources

- `/workspace/.planning/PROJECT.md` (HIGH)
- `/workspace/conway-rts/DESIGN.md` (HIGH)
- `/workspace/packages/rts-engine/src/rts.ts` (HIGH)
- `/workspace/apps/server/src/server.ts` (HIGH)
- `/workspace/apps/web/src/client.ts` (HIGH)
- `/workspace/tests/integration/server/server.test.ts` (HIGH)
- `/workspace/packages/rts-engine/test/rts.test.ts` (HIGH)
- https://socket.io/docs/v4/rooms/ (official docs, last updated Jan 22, 2026) (HIGH)
- https://www.littlewargame.com/ (landing page feature claims) (LOW-MEDIUM)
- https://conwaylife.com/wiki/Glider (pattern taxonomy/context) (MEDIUM)
- https://conwaylife.com/wiki/Block-laying_switch_engine (pattern taxonomy/context) (MEDIUM)

---

_Feature research for: Browser multiplayer Conway RTS prototype_
_Researched: 2026-02-27_
