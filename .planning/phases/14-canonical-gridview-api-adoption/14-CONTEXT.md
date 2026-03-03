# Phase 14: Canonical GridView API Adoption - Context

**Gathered:** 2026-03-03
**Status:** Ready for planning

<domain>
## Phase Boundary

Adopt `template.grid()` plus shared `GridView` transforms as the canonical way engine callers obtain transformed template geometry, while preserving existing placement and preview behavior for equivalent user inputs. This phase removes legacy offset-template entrypoints and does not add unrelated engine capabilities.

</domain>

<decisions>
## Implementation Decisions

### Cutover strategy

- Migrate all engine callers in this phase to canonical `template.grid()` / `GridView` usage.
- Legacy offset-template entrypoints should warn briefly during migration, then be fully removed by end of Phase 14.
- After cutover, legacy entrypoint usage should fail fast with blocking errors.

### Transform contract

- Caller-facing contract explicitly supports: `translate`, `rotate`, `flipHorizontal`, `flipVertical`, and direct `applyMatrix`.
- Chained transforms follow call-order semantics (operations apply in the order written).
- Rotate/flip anchor behavior must match current placement parity expectations.
- `applyMatrix` is restricted to placement-safe transforms only.

### Parity boundaries

- Preserve template-anchor semantics.
- Preserve a defined template pivot rule for rotation/flip behavior.
- Transformed coordinates are integer-only.
- Negative coordinates are preserved where relevant to existing behavior.

### Misuse handling

- Deprecated or removed legacy entrypoint calls produce immediate fail-fast errors.
- Invalid transform input produces explicit validation errors (no silent coercion).
- Matrices outside the placement-safe contract are rejected as out-of-contract.
- Contract-violation errors include actionable migration guidance.

### OpenCode's Discretion

- Exact warning wording/timing during the short warn-then-remove window.
- Exact error code naming and message phrasing, as long as messages remain actionable.
- Exact organization of validation helpers and guardrail checks.

</decisions>

<specifics>
## Specific Ideas

- Caller API should feel consistent across direct transforms and matrix-based transforms.
- Preserve existing anchor/pivot expectations rather than introducing new mental models.
- Keep geometry integer-safe and maintain negative-coordinate behavior where parity depends on it.

</specifics>

<deferred>
## Deferred Ideas

None - discussion stayed within phase scope.

</deferred>

---

_Phase: 14-canonical-gridview-api-adoption_
_Context gathered: 2026-03-03_
