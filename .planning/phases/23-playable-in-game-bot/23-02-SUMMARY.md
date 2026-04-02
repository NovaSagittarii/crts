---
phase: 23-playable-in-game-bot
plan: 02
subsystem: ui, api
tags: [socket.io, lobby, bot, web-ui, view-model]

# Dependency graph
requires:
  - phase: 23-01
    provides: bot strategy architecture decisions (D-01 host control, D-02 same protocol, D-03 visual distinction)
provides:
  - bot:add and bot:added socket contract events
  - isBot field on MembershipParticipant for bot identification
  - Server-side bot:add handler with host/lobby/slot validation
  - Add Bot button in lobby UI for host users
  - Bot badge rendering in slot member list
  - canAddBot view-model logic for conditional button display
affects: [23-03-socket-io-bot-adapter]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - 'Bot session IDs tracked in module-level Set for cross-concern isBot lookup'
    - 'setBotAddHandler delegation pattern mirrors existing setClaimHandler'
    - 'canAddBot computed from isHost + lobby status + open seats + no existing bot'

key-files:
  created: []
  modified:
    - packages/rts-engine/socket-contract.ts
    - apps/server/src/server.ts
    - apps/server/src/server-room-broadcast.ts
    - apps/web/src/lobby-membership-view-model.ts
    - apps/web/src/lobby-slot-list-ui.ts
    - apps/web/src/lobby-screen-ui.ts
    - apps/web/src/client.ts
    - apps/web/styles.css
    - tests/web/membership-fixtures.ts
    - tests/web/lobby-controls-view-model.test.ts
    - tests/web/lobby-membership-view-model.test.ts

key-decisions:
  - 'Bot session IDs stored in module-level Set<string> in server.ts, passed to RoomBroadcastService for isBot population'
  - 'canAddBot is false when slot already has a bot, preventing duplicate bots per slot'
  - 'bot:add handler generates sessionId with bot- prefix and crypto.randomUUID for uniqueness'

patterns-established:
  - "Bot badge rendering follows existing Host/Ready badge pattern with createBadge('Bot', 'badge--bot')"
  - 'Click delegation for Add Bot buttons uses data-slot-add-bot attribute, same pattern as data-slot-claim'

requirements-completed: [DEPLOY-01]

# Metrics
duration: 42min
completed: 2026-04-01
---

# Phase 23 Plan 02: Bot Add Protocol and Lobby UI Summary

**Socket contract bot:add/bot:added events with server validation, lobby Add Bot button for host, and Bot badge rendering**

## Performance

- **Duration:** 42 min
- **Started:** 2026-04-01T22:01:53Z
- **Completed:** 2026-04-01T22:44:05Z
- **Tasks:** 2
- **Files modified:** 11

## Accomplishments

- Added bot:add and bot:added events to the socket contract with BotAddPayload, BotAddedPayload, and isBot on MembershipParticipant
- Server bot:add handler validates host identity, lobby status, slot existence, and slot capacity before generating bot session ID
- Lobby UI shows "Add Bot" button for host on empty slots and renders "Bot" badge for bot members
- View-model tests verify isBot propagation and canAddBot conditional logic (3 new test cases)

## Task Commits

Each task was committed atomically:

1. **Task 1: Socket contract and server bot:add handler** - `7d57d3b` (feat)
2. **Task 2: Web UI - Add Bot button and bot indicator badge** - `364d8eb` (feat)

## Files Created/Modified

- `packages/rts-engine/socket-contract.ts` - Added isBot to MembershipParticipant, BotAddPayload, BotAddedPayload, bot:add/bot:added events
- `apps/server/src/server.ts` - Added bot:add handler with validation, botSessionIds Set, crypto import
- `apps/server/src/server-room-broadcast.ts` - Added isBot to membership payload and hash normalization
- `apps/web/src/lobby-membership-view-model.ts` - Added isBot and canAddBot to view models
- `apps/web/src/lobby-slot-list-ui.ts` - Added Bot badge rendering and Add Bot button with setBotAddHandler
- `apps/web/src/lobby-screen-ui.ts` - Added setBotAddHandler delegation
- `apps/web/src/client.ts` - Wired bot:add emit and bot:added listener
- `apps/web/styles.css` - Added badge--bot styling (purple)
- `tests/web/membership-fixtures.ts` - Added isBot default to createMembershipParticipant
- `tests/web/lobby-controls-view-model.test.ts` - Added isBot field to inline participant
- `tests/web/lobby-membership-view-model.test.ts` - Added 3 bot-related test cases

## Decisions Made

- Bot session IDs tracked in a module-level `Set<string>` rather than on the lobby aggregate, keeping the lobby domain model bot-agnostic and the bot-awareness at the server/transport layer
- `canAddBot` is false when a slot already has a bot member, preventing host from adding duplicate bots to the same slot
- Bot session IDs use `bot-` prefix with truncated UUID for human readability in logs and CLI usage

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Added isBot to membership hash normalization**

- **Found during:** Task 1
- **Issue:** The membership hash in server-room-broadcast.ts would not include isBot, causing hash inconsistency between payload content and hash
- **Fix:** Added isBot to the normalized participant object in buildMembershipHashFromPayload
- **Files modified:** apps/server/src/server-room-broadcast.ts
- **Verification:** Lint passes, existing tests pass
- **Committed in:** 7d57d3b (Task 1 commit)

**2. [Rule 3 - Blocking] Updated inline participant in controls test with isBot field**

- **Found during:** Task 1
- **Issue:** Inline participant object in lobby-controls-view-model.test.ts was missing the new required isBot field
- **Fix:** Added `isBot: false` to the inline participant object
- **Files modified:** tests/web/lobby-controls-view-model.test.ts
- **Verification:** Test file passes
- **Committed in:** 7d57d3b (Task 1 commit)

---

**Total deviations:** 2 auto-fixed (1 missing critical, 1 blocking)
**Impact on plan:** Both fixes necessary for correctness and test compilation. No scope creep.

## Issues Encountered

None

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Socket contract is ready for Plan 03 (Socket.IO bot adapter) to implement the bot process that connects using the botSessionId
- The bot:added payload provides the botSessionId that the bot process needs as a CLI flag
- The isBot flag flows through to the match UI for visual distinction during gameplay

## Self-Check: PASSED

All created/modified files verified present. Both task commits (7d57d3b, 364d8eb) confirmed in git history.

---

_Phase: 23-playable-in-game-bot_
_Completed: 2026-04-01_
