# Phase 18: Parity Closure and Migration Cleanup - Context

**Gathered:** 2026-03-03
**Status:** Ready for planning

<domain>
## Phase Boundary

Prove parity across core gameplay flows and retire temporary migration-only assertions before milestone close. This phase must not introduce gameplay drift or authoritative contract changes.

</domain>

<decisions>
## Implementation Decisions

### Parity coverage scope

- Required parity gates cover preview, queue, apply, integrity, and structure-key stability across representative transform sequences.
- Mandatory coverage includes all supported transform orientations for each gated flow.
- Mandatory parity dimensions match exactly: accept/reject outcome, rejection reason taxonomy, and resulting resource/structure state outcomes.
- Any unexplained mismatch blocks phase completion until resolved.

### OpenCode's Discretion

- Choose the concrete representative transform sequences and fixtures, as long as all required gated flows and orientations are covered.
- Decide how to organize parity evidence outputs (test grouping, naming, and reporting format) in repo conventions.
- Sequence migration-assertion cleanup work in the safest order, provided temporary migration-only assertions are fully retired before phase close and parity suites stay green.

</decisions>

<specifics>
## Specific Ideas

No specific product/style references were requested; focus is strict, auditable parity closure.

</specifics>

<deferred>
## Deferred Ideas

None - discussion stayed within phase scope.

</deferred>

---

_Phase: 18-parity-closure-and-migration-cleanup_
_Context gathered: 2026-03-03_
