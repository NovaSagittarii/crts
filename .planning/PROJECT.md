# Conway RTS TypeScript Prototype

## What This Is

This project is a TypeScript prototype of the existing `/workspace/conway-rts/DESIGN.md` concept: a multiplayer Conway's Game of Life RTS where players defend a vulnerable safe cell and attack opponents with pattern-based structures. The current codebase already provides a server-authoritative realtime Conway/RTS foundation, and this milestone focuses on shaping it into a playable end-to-end experience. The immediate product goal is a lobby-and-team-first flow that leads into a complete match loop.

## Core Value

Two players can quickly get into a match and use Conway-based strategy to defend their safe cell and breach the opponent's.

## Requirements

### Validated

- ✓ Realtime server-authoritative room simulation and state broadcast loop — existing
- ✓ Deterministic Conway grid stepping and update application — existing
- ✓ Template/build queue processing with RTS room/team domain model — existing
- ✓ Browser client rendering and Socket.IO intent/state flow — existing

### Active

- [ ] Lobby-first multiplayer flow: create/join room, assign teams, and start match reliably
- [ ] Safe-cell breach win condition aligned with the DESIGN.md game premise
- [ ] Ghost-cell batch planning and commit workflow for predictable construction edits
- [ ] Practical template catalog (offense/defense/support) for quick strategic placement
- [ ] Resource economy display and spending loop that supports build choices in-match
- [ ] Playable end-to-end two-player match in browser with clear victory/defeat feedback

### Out of Scope

- WebAssembly simulation pipeline — prototype optimizes for TypeScript iteration speed
- Protobuf network protocol — Socket.IO JSON events are sufficient for this milestone
- Account/auth system and persistent profile storage — session-level identity is enough for prototype validation
- Large-scale performance hardening for very large maps — defer until gameplay loop is validated

## Context

- The repo is a brownfield TypeScript mono-repo with runtime layers in `apps/` and deterministic game logic in `packages/`.
- Existing architecture already includes a Socket.IO server (`apps/server/src/server.ts`), browser client (`apps/web/src/client.ts`), Conway core (`packages/conway-core/src/grid.ts`), and RTS domain engine (`packages/rts-engine/src/rts.ts`).
- Codebase map docs in `.planning/codebase/` confirm working foundations for rooms, ticks, build queues, and state payloads.
- Product direction is grounded in `/workspace/conway-rts/DESIGN.md`, adapted to TypeScript with simplified implementation choices.

## Constraints

- **Tech stack**: TypeScript + Node.js + Socket.IO + Vite — stay aligned with existing repository architecture and tooling.
- **Implementation scope**: No wasm/protobuf in this milestone — prioritize gameplay and product validation first.
- **Experience target**: Lobby/team setup must be reliable before deeper strategy expansion.
- **Definition of done**: End-to-end playable multiplayer match is required, not just isolated engine parity.

## Key Decisions

| Decision                                                  | Rationale                                                               | Outcome   |
| --------------------------------------------------------- | ----------------------------------------------------------------------- | --------- |
| Build as TypeScript-only prototype (no wasm, no protobuf) | Reduces integration complexity and speeds iteration on gameplay         | — Pending |
| Prioritize lobby + team system in Phase 1                 | Match setup friction blocks all gameplay validation if not solved first | — Pending |
| Treat playable end-to-end match as completion bar         | Ensures work optimizes for real user flow, not disconnected subsystems  | — Pending |
| Keep server-authoritative deterministic simulation model  | Preserves current architecture strengths and multiplayer consistency    | — Pending |

---

_Last updated: 2026-02-27 after initialization_
