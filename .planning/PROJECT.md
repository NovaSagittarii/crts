# Conway RTS TypeScript Prototype

## What This Is

This is a shipped TypeScript multiplayer Conway RTS prototype: two players can form a room, start a deterministic match, queue validated build actions, watch economy/queue state in the HUD, and resolve matches with explicit breach outcomes.

## Core Value

Two players can quickly get into a match and use Conway-based strategy to defend their safe cell and breach the opponent's.

## Current State

**Shipped version:** `v0.0.1` (2026-03-01)

- End-to-end 1v1 loop is operational from room join through defeat lockout.
- Deterministic queue-only mutation pipeline is enforced with explicit terminal outcomes.
- Economy and queue visibility are exposed in the web client with authoritative affordability metadata.
- Quality gates exist for both unit (`QUAL-01`) and integration (`QUAL-02`) coverage.
- Milestone archive artifacts are stored in `.planning/milestones/`.

## Next Milestone Goals

- [ ] Define and implement ghost-cell draft/commit workflow (`GAME-01`).
- [ ] Expand offense/defense/support template catalog (`GAME-02`).
- [ ] Add near-safe-cell threat indicators (`GAME-03`).
- [ ] Finalize explicit room capacity/overflow behavior and corresponding tests.

## Requirements

### Validated in v0.0.1

- ✓ Lobby and reconnect reliability (`LOBBY-01`, `LOBBY-03`, `LOBBY-04`)
- ✓ Match lifecycle and breach outcomes (`MATCH-01`, `MATCH-02`, `MATCH-03`)
- ✓ Deterministic build queue validation (`BUILD-01`, `BUILD-02`, `BUILD-03`, `BUILD-04`)
- ✓ Economy + queue visibility (`ECON-01`, `ECON-02`, `ECON-03`, `UX-01`)
- ✓ Quality gates (`QUAL-01`, `QUAL-02`)
- Delivered capability (excluded from closure accounting): `LOBBY-02`

### Active (Next Milestone Candidates)

- [ ] `GAME-01`: Ghost-cell draft/commit workflow
- [ ] `GAME-02`: Expanded template catalog beyond baseline set
- [ ] `GAME-03`: Near-safe-cell threat indicators
- [ ] Room capacity and overflow handling hardening

### Out of Scope

- WebAssembly simulation pipeline — prototype still optimizes for TypeScript iteration speed.
- Protobuf network protocol — Socket.IO JSON contracts remain sufficient for current scope.
- Account/auth system and persistent profile storage — session identity remains enough for prototype validation.
- Large-scale performance hardening for very large maps — defer until expansion requirements are validated.

## Context

- Monorepo architecture remains `apps/` for runtime layers and `packages/` for deterministic reusable logic.
- Milestone `v0.0.1` shipped across 5 phases, 16 plans, and 48 documented tasks.
- Quality gates now include explicit `test:quality` command composition (`test:unit` + `test:integration`).
- Milestone artifacts are archived for stable context usage in future planning.

## Constraints

- **Tech stack:** TypeScript + Node.js + Socket.IO + Vite; keep deterministic logic in shared packages.
- **Scope control:** Avoid wasm/protobuf/auth persistence until expansion scope requires them.
- **Quality gate:** Maintain requirement-traceable tests for each new milestone requirement.
- **UX reliability:** Preserve authoritative server payloads as the only source for client state.

## Key Decisions

| Decision                                                    | Rationale                                                             | Outcome |
| ----------------------------------------------------------- | --------------------------------------------------------------------- | ------- |
| Build as TypeScript-only prototype (no wasm, no protobuf)   | Reduces integration complexity and keeps iteration fast               | ✓ Good  |
| Prioritize lobby/team reliability before deeper strategy    | Setup friction blocks all gameplay validation if left unresolved      | ✓ Good  |
| Treat playable end-to-end match as milestone completion bar | Ensures delivery reflects real player flow, not disconnected features | ✓ Good  |
| Keep server-authoritative deterministic simulation model    | Preserves consistency across runtime layers and tests                 | ✓ Good  |

---

_Last updated: 2026-03-01 after v0.0.1 milestone completion_
