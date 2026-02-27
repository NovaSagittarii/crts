# Roadmap: Conway RTS TypeScript Prototype

## Overview

This roadmap delivers a reliable 1v1 Conway RTS loop in dependency order: players first form stable rooms/teams, then run a governed match lifecycle, then execute deterministic build actions, then use economy/queue UX for in-match decisions, and finally lock quality gates that prove the full loop works end to end.

## Phases

- [ ] **Phase 1: Lobby & Team Reliability** - Players can reliably create/join rooms, pick teams, and reconnect without state drift.
- [ ] **Phase 2: Match Lifecycle & Breach Outcomes** - Matches progress through legal lifecycle states and end with explicit winner/loser results.
- [ ] **Phase 3: Deterministic Build Queue Validation** - All gameplay mutations run through validated queue paths with terminal build outcomes.
- [ ] **Phase 4: Economy HUD & Queue Visibility** - Players can make informed build decisions using live resources/income and pending queue timeline.
- [ ] **Phase 5: Quality Gate Validation** - Unit and integration test suites prove lobby-to-defeat flow is stable and repeatable.

## Phase Details

### Phase 1: Lobby & Team Reliability

**Goal**: Users can reliably assemble into rooms, choose teams, and rejoin sessions with authoritative state continuity.
**Depends on**: Nothing (first phase)
**Requirements**: LOBBY-01, LOBBY-02, LOBBY-03, LOBBY-04
**Success Criteria** (what must be TRUE):

1. User can list, create, join, and leave rooms, and all participants observe deterministic membership updates.
2. User can join a team and receive deterministic base assignment for that team.
3. Team spawn locations are equally spaced on the torus map and do not overlap.
4. Reconnecting user can rejoin their room and receive authoritative state resync.

**Plans**: TBD

### Phase 2: Match Lifecycle & Breach Outcomes

**Goal**: Users can start and complete matches through one authoritative lifecycle with unambiguous win/lose outcomes.
**Depends on**: Phase 1
**Requirements**: MATCH-01, MATCH-02, MATCH-03
**Success Criteria** (what must be TRUE):

1. Host can start a match only when preconditions are satisfied, and room state transitions `lobby -> countdown -> active -> finished`.
2. Match ends using one canonical breach rule with explicit winner and loser outcomes.
3. Defeated user is blocked from gameplay actions and sees clear defeat state.

**Plans**: TBD

### Phase 3: Deterministic Build Queue Validation

**Goal**: Users can perform construction actions only through a deterministic, validated queue with explicit outcomes.
**Depends on**: Phase 2
**Requirements**: BUILD-01, BUILD-02, BUILD-03, BUILD-04
**Success Criteria** (what must be TRUE):

1. User can queue a template build and receives queued acknowledgement including execute tick.
2. Every queued build reaches a terminal outcome of `applied` or `rejected(reason)`.
3. Out-of-bounds or invalid-territory build attempts are rejected with explicit reasons.
4. Gameplay mutations are accepted only through validated queue paths; direct bypass mutation attempts are rejected.

**Plans**: TBD

### Phase 4: Economy HUD & Queue Visibility

**Goal**: Users can evaluate affordability, expected income, and pending actions while deciding what to build.
**Depends on**: Phase 3
**Requirements**: ECON-01, ECON-02, ECON-03, UX-01
**Success Criteria** (what must be TRUE):

1. User can see current resources and per-tick income in the match HUD.
2. User can queue affordable builds, and unaffordable requests are rejected with clear reasons.
3. User sees resource income change dynamically based on owned structures or territory state.
4. User can inspect pending builds in a queue timeline organized by execute tick.

**Plans**: TBD

### Phase 5: Quality Gate Validation

**Goal**: Developers can verify the full gameplay loop with repeatable automated tests before expanding scope.
**Depends on**: Phase 4
**Requirements**: QUAL-01, QUAL-02
**Success Criteria** (what must be TRUE):

1. Developer can run unit tests that cover lobby/team invariants, queue validation, queue terminal outcomes, and economy rules.
2. Developer can run integration tests that cover join -> build -> tick -> breach -> defeat end-to-end flow.

**Plans**: TBD

## Progress

| Phase                                   | Plans Complete | Status      | Completed |
| --------------------------------------- | -------------- | ----------- | --------- |
| 1. Lobby & Team Reliability             | 0/TBD          | Not started | -         |
| 2. Match Lifecycle & Breach Outcomes    | 0/TBD          | Not started | -         |
| 3. Deterministic Build Queue Validation | 0/TBD          | Not started | -         |
| 4. Economy HUD & Queue Visibility       | 0/TBD          | Not started | -         |
| 5. Quality Gate Validation              | 0/TBD          | Not started | -         |
