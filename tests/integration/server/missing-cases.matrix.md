# Integration Missing-Cases Matrix

Status: planned coverage only. Existing integration tests remain unchanged for now.

## Immediate Cases

| ID    | Scenario                                       | Setup                                                                     | Action                                                                                                  | Expected Contract                                                                       |
| ----- | ---------------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| MC-01 | Join unknown room is rejected                  | Connect one client                                                        | Emit `room:join` with unknown `roomId` and unknown `roomCode`                                           | Receive `room:error` with `reason: "room-not-found"`                                    |
| MC-02 | Claim invalid slot id is rejected              | Create room and join it                                                   | Emit `room:claim-slot` with invalid `slotId`                                                            | Receive `room:error` with `reason: "invalid-slot"`                                      |
| MC-03 | Claim held slot is rejected until hold expires | Player A claims `team-1`, disconnects to create hold, player B is present | Player B emits `room:claim-slot` for `team-1` during hold window                                        | Receive `room:error` with `reason: "slot-held"`; claim succeeds only after hold expires |
| MC-04 | Invalid ready payload is rejected              | Create room and join it                                                   | Emit `room:set-ready` with non-boolean payload                                                          | Receive `room:error` with `reason: "invalid-ready"`                                     |
| MC-05 | Invalid chat payload is rejected               | Create room and join it                                                   | Emit `chat:send` with empty/whitespace-only message                                                     | Receive `room:error` with `reason: "invalid-chat"`                                      |
| MC-06 | Invalid build payload is rejected              | Start active match with valid player assignment                           | Emit `build:queue` with malformed payload (for example missing/invalid coordinates or template id type) | Receive `room:error` with `reason: "invalid-build"`                                     |

## Deferred Cases

| ID    | Scenario                                                           | Setup                                                                  | Action                                                                           | Expected Contract                                                                                              |
| ----- | ------------------------------------------------------------------ | ---------------------------------------------------------------------- | -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| MC-07 | Non-default room is removed after last participant leaves          | Create custom room with two participants                               | Both participants leave; requester emits `room:list`                             | Custom room id no longer appears in `room:list`                                                                |
| MC-08 | Name sanitization propagates to profile, membership, and state     | Join room with one claimed slot                                        | Emit `player:set-name` with padded/overlong input                                | Sanitized name appears in `player:profile`, `room:membership.participants`, and team player display in `state` |
| MC-09 | Join with `slotId` auto-claims when available                      | Create room; one client joins via `room:join`                          | Emit `room:join` with room identifier plus available `slotId`                    | `room:joined.teamId` and `room:slot-claimed` confirm auto-claim                                                |
| MC-10 | Stale socket is rejected across handlers after session replacement | Connect two sockets with same `sessionId`, newer connection takes over | Old socket emits `room:claim-slot`, `room:start`, `chat:send`, and `build:queue` | Each mutation receives `room:error` with `reason: "session-replaced"`                                          |

## Notes

- Use ephemeral ports (`port: 0`) and bounded event waits for deterministic assertions.
- Keep assertions on externally visible events and payloads only.
- When implementing, prefer adding focused scenarios in `tests/integration/server/*.test.ts` rather than one oversized case.
