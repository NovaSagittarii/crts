# Phase 4: Economy HUD & Queue Visibility - Context

**Gathered:** 2026-02-28
**Status:** Ready for planning

<domain>
## Phase Boundary

Deliver in-match visibility and feedback so players can decide what to queue by seeing current resources, net income per tick, affordability feedback for build actions, and pending builds organized by execute tick. This phase does not add new gameplay capabilities beyond presenting and validating these economy and queue signals.

</domain>

<decisions>
## Implementation Decisions

### Affordability feedback

- If a selected build is unaffordable, the queue action is disabled and shows an inline reason.
- If a queue request is rejected, show the rejection reason inline near the queue action.
- Rejection text includes exact resource deficits (needed vs current).
- The build list shows affordability using color state and numeric cost before submission.

### HUD resource readout

- Always display current resources and net income per tick.
- Place this readout near the build panel during active play.
- Resource and income changes use a subtle tick pulse cue.
- Show net-per-tick by default, with deeper income breakdown on hover or expand.

### Queue timeline shape

- Pending builds are visually grouped by execute tick.
- Each queue item shows template, execute tick, and ETA.
- Timing is shown in relative format only (countdown or ETA), not as absolute tick labels.
- The timeline view focuses on pending items only in this phase.

### Income change signaling

- Net income changes show an HUD delta chip.
- Income change cues include a short cause label.
- If net income becomes negative, indicate it with color change only.
- Multiple small changes are aggregated into one cue per tick.

### OpenCode's Discretion

- No areas were explicitly delegated with "you decide".
- OpenCode may choose exact microcopy and visual styling while preserving all locked behaviors above.

</decisions>

<specifics>
## Specific Ideas

No external product references were provided. Prioritize at-a-glance readability and low visual noise within the locked decisions.

</specifics>

<deferred>
## Deferred Ideas

None - discussion stayed within phase scope.

</deferred>

---

_Phase: 04-economy-hud-queue-visibility_
_Context gathered: 2026-02-28_
