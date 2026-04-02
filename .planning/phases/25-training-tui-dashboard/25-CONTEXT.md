# Phase 25: Training TUI Dashboard - Context

**Gathered:** 2026-04-01
**Status:** Ready for planning

<domain>
## Phase Boundary

Live terminal UI dashboard that replaces plain console.log output during PPO training with a structured, auto-updating two-column display showing progress, charts, metrics, and opponent pool status. Includes keyboard interactivity for pause/stop/view cycling.

</domain>

<decisions>
## Implementation Decisions

### Dashboard Layout

- **D-01:** Two-column split layout. Left column: progress bar + ASCII mini-charts (reward, loss). Right column: detailed metrics table, opponent pool breakdown, recent episode log.
- **D-02:** Requires ~100 column terminal width. Falls back to stacked single-column for narrower terminals.
- **D-03:** Opponent pool status section included: pool size, sampling ratios (latest/historical/random), latest checkpoint episode number.

### Rendering Approach

- **D-04:** Use Ink (React for CLI) as the rendering library. Leverages React component model for complex layouts, ecosystem packages (ink-spinner, ink-box, etc.).
- **D-05:** Dual refresh triggers: update on every episode completion AND on a configurable fixed interval (default 500ms). Whichever fires first triggers a redraw.
- **D-06:** Degrade gracefully to plain log lines when stdout is not a TTY (e.g. CI, piped output). `--no-tui` flag to force plain mode.

### Metric Display Style

- **D-07:** Reward trend and policy/value loss get ASCII line charts (multi-row character charts with axes). Displayed in the left column.
- **D-08:** Win rate, entropy, approx KL, ETA, time/generation, episodes/sec shown as colored numbers with green/red trend indicators. Displayed in the right column metrics table.
- **D-09:** Charts show last N data points (configurable window, default ~50 episodes).

### Interactivity

- **D-10:** Dashboard accepts keyboard input during training via raw stdin mode.
- **D-11:** Key bindings: Space = pause/resume training, q = graceful stop, Tab = cycle detail views, h = show help overlay.
- **D-12:** Pause stops episode collection but keeps the TUI rendering. Resume continues from where it left off.

### Claude's Discretion

- Chart axis scaling and auto-ranging approach
- Ink component structure and state management
- Color scheme and ANSI color choices
- Help overlay content and layout
- Exact fallback behavior for narrow terminals

</decisions>

<canonical_refs>

## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Training Pipeline

- `packages/bot-harness/training/training-coordinator.ts` -- TrainingCoordinator.run() loop, episode callbacks
- `packages/bot-harness/training/training-logger.ts` -- TrainingLogger, TrainingLogEntry, formatLiveMetrics()
- `packages/bot-harness/training/training-config.ts` -- TrainingConfig, parseTrainingArgs
- `bin/train.ts` -- Current CLI entry point (to be extended with TUI)

### Existing Metrics

- `packages/bot-harness/training/training-logger.ts` -- TrainingLogEntry interface defines all available metrics

</canonical_refs>

<code_context>

## Existing Code Insights

### Reusable Assets

- `TrainingLogger.formatLiveMetrics()` -- already formats one-line metric strings with episode, reward, win rate, losses, entropy, KL, ticks, ETA
- `TrainingLogEntry` interface -- defines all metric fields available per episode
- `TrainingCoordinator` -- has episode-level granularity in its run loop, can emit per-episode data

### Established Patterns

- CLI entry points in `bin/` directory with `parseArgs` from `node:util`
- Training config via `parseTrainingArgs()` returning `TrainingConfig`
- SIGINT/SIGTERM handlers for graceful shutdown already in `bin/train.ts`

### Integration Points

- `bin/train.ts` -- needs to conditionally render TUI vs plain output based on TTY detection and `--no-tui` flag
- `TrainingCoordinator.run()` -- needs a callback or event mechanism for per-episode metric updates to feed the TUI
- Existing `console.log` startup banner in `bin/train.ts` should be absorbed into TUI header

</code_context>

<specifics>
## Specific Ideas

No specific requirements -- open to standard approaches for Ink-based TUI design.

</specifics>

<deferred>
## Deferred Ideas

None -- discussion stayed within phase scope.

</deferred>

---

_Phase: 25-training-tui-dashboard_
_Context gathered: 2026-04-01_
