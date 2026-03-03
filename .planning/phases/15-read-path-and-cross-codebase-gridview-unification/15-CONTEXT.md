# Phase 15: Read-Path and Cross-Codebase GridView Unification - Context

**Gathered:** 2026-03-03
**Status:** Ready for planning

<domain>
## Phase Boundary

Unify read-side geometry and other duplicated transformed-grid read paths onto shared GridView utilities while preserving current player-visible outcomes. This phase covers parity-preserving migration of transformed-cell reads and overlay behavior, not new gameplay capabilities.

</domain>

<decisions>
## Implementation Decisions

### Parity boundaries

- Parity is **observable-equivalent**: player-visible transformed cells must match current behavior.
- Non-observable internal differences are allowed only when explicitly allowlisted and documented.
- Phase is blocked by any non-allowlisted parity delta that changes player-visible outcomes.

### Overlay stability

- After reconnect, structure/build-zone overlay cells remain identical for the same game state.
- Repeated rotate/translate sequences must show no visible wobble or state flip-flop.
- Mid-session reconnect restores prior overlay orientation/position context instead of resetting defaults.
- If overlay data is briefly unavailable post-reconnect, show last-known overlay with a stale indicator until refreshed.

### Scenario matrix

- Validate a full transform matrix (rotations plus representative translations, including origin and edge placements).
- Include sparse, dense, and edge-heavy board-state contexts in parity validation.
- Cover both single reconnect and repeated reconnect loops.
- Require deterministic outcomes across repeated runs of the same transform input timeline.

### Ambiguous legacy cases

- When duplicated legacy paths disagree, default to preserving current player-visible behavior.
- For non-obvious ambiguities, prioritize session stability across reconnect and repeated transforms.
- Document every resolved ambiguity with the chosen behavior and expected outcome.
- If a late ambiguity cannot be fully resolved in this phase, allowlist the delta and create a follow-up item.

### OpenCode's Discretion

- Choose the exact authoritative legacy source per ambiguous duplicate path, as long as player-visible behavior is preserved.
- Define helper-level matching criteria for non-player-visible outputs (for example size-estimation paths) within observable-equivalence and allowlist rules.
- Choose the documentation structure for ambiguity logs and allowlist entries.

</decisions>

<specifics>
## Specific Ideas

- Preserve strict visual stability during interaction: "no wobble" under repeated transform sequences.
- Use "last known + stale hint" for short post-reconnect overlay data gaps.
- Keep ambiguity handling explicit: "document every case".
- No external product reference was requested; decisions are behavior constraints.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

_Phase: 15-read-path-and-cross-codebase-gridview-unification_
_Context gathered: 2026-03-03_
