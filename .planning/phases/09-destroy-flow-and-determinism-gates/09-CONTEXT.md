# Phase 9: Destroy Flow and Determinism Gates - Context

**Gathered:** 2026-03-01
**Status:** Ready for planning

<domain>
## Phase Boundary

Players can destroy owned structures during active matches through authoritative controls, with deterministic accept/reject outcomes and reconnect-safe parity so both clients converge on the same structure and build-eligibility state. This phase does not add new gameplay capabilities outside destroy plus determinism gating.

</domain>

<decisions>
## Implementation Decisions

### Destroy interaction flow

- Destroy control appears in the action bar only when an owned structure is selected.
- Interaction sequence is select owned structure first, then activate destroy.
- Destroy flow is single-action: after a successful destroy, exit destroy-ready state.
- While a destroy is pending, player may target a different structure; repeated same-target requests are idempotent and ignored by the server.

### Safety and confirmation behavior

- Default destroy behavior is immediate on click (no confirmation for most structures).
- Destroy controls are hidden for non-owned structures.
- Pending destroy has an explicit visual pending state until authoritative outcome arrives.
- Base structure requires extra inline confirm before destroy.
- Confirmation requirement should be implemented as a structure-level property so future structure types can opt into the same behavior.

### Outcome and rejection feedback

- On accepted destroy, acting player sees a subtle success toast plus authoritative board update.
- Opponent receives no explicit destroy notice; they infer changes from authoritative board and build-eligibility updates.
- Rejected destroy attempts return specific deterministic reasons (wrong owner, invalid target, invalid lifecycle state).
- Acting player sees rejection feedback both inline near the destroy control and as a toast.

### Reconnect and parity expectations

- Reconnecting clients snap directly to authoritative current state (no replay requirement).
- Destroy requests follow server queue semantics like build actions; pending requests auto-retry from server-side queue handling on reconnect.
- Determinism acceptance is based on identical authoritative outcomes and resulting structure/build-eligibility state across both clients.
- Show a small "Reconnected, state synced" notice after successful resync.

### OpenCode's Discretion

- Exact copy style, timing, and visual treatment for toasts and inline indicators.
- Exact presentation details for pending and reconnect notices, as long as they remain subtle and non-blocking.

</decisions>

<specifics>
## Specific Ideas

- Destroy is idempotent for duplicate same-target requests while preserving ability to target a different structure during pending state.
- Use base-destroy confirmation as the first instance of a generalizable per-structure confirmation property.
- Reconnect behavior should mirror existing server-queued event semantics used for build actions.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

_Phase: 09-destroy-flow-and-determinism-gates_
_Context gathered: 2026-03-01_
