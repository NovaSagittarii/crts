# Phase 25: Training TUI Dashboard - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md -- this log preserves the alternatives considered.

**Date:** 2026-04-01
**Phase:** 25-training-tui-dashboard
**Areas discussed:** Dashboard layout, Rendering approach, Metric display style, Interactivity

---

## Dashboard Layout

| Option              | Description                                              | Selected |
| ------------------- | -------------------------------------------------------- | -------- |
| Single-pane stacked | Vertically stacked sections, works in any width          |          |
| Two-column split    | Left: progress + charts. Right: details. Needs ~100 cols | ✓        |
| Tabbed views        | Multiple switchable screens                              |          |

**User's choice:** Two-column split
**Notes:** Left column gets progress + charts, right column gets detailed metrics table, opponent pool, and recent episode log.

### Follow-up: Column contents

| Option                                  | Description | Selected |
| --------------------------------------- | ----------- | -------- |
| Left: progress + metrics, Right: charts |             |          |
| Left: progress + charts, Right: details |             | ✓        |
| You decide                              |             |          |

**User's choice:** Left: progress + charts, Right: details

### Follow-up: Opponent pool section

| Option                                           | Description | Selected |
| ------------------------------------------------ | ----------- | -------- |
| Yes -- show pool size, ratios, latest checkpoint |             | ✓        |
| No -- keep focused on training metrics           |             |          |

**User's choice:** Yes, include opponent pool status

---

## Rendering Approach

| Option                    | Description                                     | Selected |
| ------------------------- | ----------------------------------------------- | -------- |
| Ink (React for CLI)       | React component model, rich ecosystem, ~15 deps | ✓        |
| Raw ANSI escape codes     | Zero dependencies, full control, more code      |          |
| Blessed / blessed-contrib | Full widget toolkit, heavy, unmaintained        |          |

**User's choice:** Ink (React for CLI)

### Follow-up: Refresh rate

| Option                 | Description                   | Selected |
| ---------------------- | ----------------------------- | -------- |
| Per-episode            | Update after each episode     |          |
| Fixed interval (500ms) | Timer-based redraw            |          |
| Per-batch              | Update after collection batch |          |

**User's choice:** Both per-episode AND fixed configurable interval (default 500ms)
**Notes:** Dual trigger -- whichever fires first causes a redraw.

---

## Metric Display Style

| Option                         | Description                          | Selected |
| ------------------------------ | ------------------------------------ | -------- |
| Unicode sparklines             | Compact inline chars                 |          |
| ASCII line charts              | Multi-row character charts with axes | ✓        |
| Numbers only with color trends | Plain numbers with green/red colors  |          |

**User's choice:** ASCII line charts

### Follow-up: Which metrics get charts

| Option                                            | Description                         | Selected |
| ------------------------------------------------- | ----------------------------------- | -------- |
| Charts: reward + loss. Numbers: everything else   | Two charts, rest as colored numbers | ✓        |
| Charts: reward, policy loss, value loss, win rate | Four charts (2x2)                   |          |
| You decide                                        |                                     |          |

**User's choice:** Charts for reward + loss; numbers with color trends for win rate, entropy, KL, ETA, ticks

---

## Interactivity

| Option                                 | Description                       | Selected |
| -------------------------------------- | --------------------------------- | -------- |
| Yes -- pause, early stop, toggle views | Full keyboard input via raw stdin | ✓        |
| Minimal -- just 'q' to quit            | Single key for shutdown           |          |
| Display only -- no keyboard input      | Ctrl+C only                       |          |

**User's choice:** Full interactivity

### Follow-up: Key bindings

| Option                                            | Description              | Selected |
| ------------------------------------------------- | ------------------------ | -------- |
| Space=pause, q=stop, tab=view, h=help             | Standard TUI conventions | ✓        |
| Vim-style: p=pause, q=quit, j/k=scroll, 1-3=views |                          |          |
| You decide                                        |                          |          |

**User's choice:** Space=pause, q=stop, tab=view, h=help

---

## Claude's Discretion

- Chart axis scaling and auto-ranging
- Ink component structure and state management
- Color scheme and ANSI colors
- Help overlay design
- Narrow terminal fallback behavior

## Deferred Ideas

None -- discussion stayed within phase scope.
