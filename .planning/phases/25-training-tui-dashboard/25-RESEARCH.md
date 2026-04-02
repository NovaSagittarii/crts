# Phase 25: Training TUI Dashboard - Research

**Researched:** 2026-04-01
**Domain:** Terminal UI rendering with Ink (React for CLI), ASCII charting, keyboard input
**Confidence:** HIGH

## Summary

This phase replaces the plain `console.log` output in `bin/train.ts` with a live-updating terminal dashboard built using Ink (React for CLI). The user has locked Ink as the rendering library (D-04), so this research focuses on Ink 6.x API patterns, integration with the existing `TrainingCoordinator` loop, ASCII chart rendering, keyboard interactivity, and graceful non-TTY fallback.

The core technical challenge is bridging the `TrainingCoordinator`'s batch-oriented training loop (which currently has no callback/event mechanism) with Ink's React state model. The coordinator needs a lightweight callback interface so per-episode and per-batch metrics flow into React state, driving TUI re-renders. The existing `TrainingLogEntry` interface already defines all required metric fields. The `formatLiveMetrics()` method on `TrainingLogger` provides a fallback formatting path for non-TTY mode.

**Primary recommendation:** Add an `onEpisode` callback to `TrainingCoordinator`, build the TUI as a set of Ink components in `packages/bot-harness/training/tui/`, use `asciichart` for ASCII line charts, and gate TUI vs plain output at the `bin/train.ts` level based on `process.stdout.isTTY` and `--no-tui` flag.

<user_constraints>

## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** Two-column split layout. Left column: progress bar + ASCII mini-charts (reward, loss). Right column: detailed metrics table, opponent pool breakdown, recent episode log.
- **D-02:** Requires ~100 column terminal width. Falls back to stacked single-column for narrower terminals.
- **D-03:** Opponent pool status section included: pool size, sampling ratios (latest/historical/random), latest checkpoint episode number.
- **D-04:** Use Ink (React for CLI) as the rendering library. Leverages React component model for complex layouts, ecosystem packages (ink-spinner, ink-box, etc.).
- **D-05:** Dual refresh triggers: update on every episode completion AND on a configurable fixed interval (default 500ms). Whichever fires first triggers a redraw.
- **D-06:** Degrade gracefully to plain log lines when stdout is not a TTY (e.g. CI, piped output). `--no-tui` flag to force plain mode.
- **D-07:** Reward trend and policy/value loss get ASCII line charts (multi-row character charts with axes). Displayed in the left column.
- **D-08:** Win rate, entropy, approx KL, ETA, time/generation, episodes/sec shown as colored numbers with green/red trend indicators. Displayed in the right column metrics table.
- **D-09:** Charts show last N data points (configurable window, default ~50 episodes).
- **D-10:** Dashboard accepts keyboard input during training via raw stdin mode.
- **D-11:** Key bindings: Space = pause/resume training, q = graceful stop, Tab = cycle detail views, h = show help overlay.
- **D-12:** Pause stops episode collection but keeps the TUI rendering. Resume continues from where it left off.

### Claude's Discretion

- Chart axis scaling and auto-ranging approach
- Ink component structure and state management
- Color scheme and ANSI color choices
- Help overlay content and layout
- Exact fallback behavior for narrow terminals

### Deferred Ideas (OUT OF SCOPE)

None -- discussion stayed within phase scope.
</user_constraints>

## Project Constraints (from CLAUDE.md)

- Strict TypeScript mode; avoid `any`
- Explicit `.js` extensions in relative imports
- Explicit return types for exported functions
- Interfaces for object shapes; type aliases for unions
- Import direction: `apps/*` may import from `packages/*`; `packages/*` must never import from `apps/*`
- CLI entry points live in `bin/` directory using `node:util` `parseArgs`
- Use `#bot-harness` alias for package imports
- Keep `npm run lint` passing (ESLint + `typescript-eslint` `recommendedTypeChecked`)
- `conway-rts/` is legacy -- do not edit
- Use Conventional Commits

## Standard Stack

### Core

| Library      | Version | Purpose                          | Why Standard                                                                  |
| ------------ | ------- | -------------------------------- | ----------------------------------------------------------------------------- |
| ink          | 6.8.0   | React renderer for terminal      | User-locked decision (D-04). Component-based TUI with Flexbox layout via Yoga |
| react        | 19.2.4  | Component model and hooks        | Required peer dependency for Ink 6.x                                          |
| @types/react | 19.2.14 | TypeScript definitions for React | Required for strict TS compilation of JSX/TSX                                 |

### Supporting

| Library             | Version | Purpose                          | When to Use                                       |
| ------------------- | ------- | -------------------------------- | ------------------------------------------------- |
| asciichart          | 1.5.25  | ASCII line chart rendering       | D-07: reward trend and loss charts in left column |
| @types/asciichart   | 1.5.8   | TypeScript types for asciichart  | Type-safe chart generation                        |
| ink-spinner         | 5.0.0   | Loading/progress spinner         | Optional: show during batch collection phase      |
| ink-testing-library | 4.0.0   | Test renderer for Ink components | Unit testing TUI components without real terminal |

### Alternatives Considered

| Instead of  | Could Use               | Tradeoff                                                                                                                                          |
| ----------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| asciichart  | @pppp606/ink-chart      | Ink-native LineGraph component, but very new (v0.2.5, published 2026-04-01), low adoption. asciichart is mature (1.5.25), zero-dep, battle-tested |
| asciichart  | Hand-rolled ASCII chart | Unnecessary complexity for simple line charts with known data ranges                                                                              |
| ink-spinner | Custom spinner          | ink-spinner is trivial and works out of box with Ink 6                                                                                            |

**Installation:**

```bash
npm install ink react @types/react asciichart @types/asciichart
npm install -D ink-testing-library
```

Note: `ink-spinner` is optional. If used: `npm install ink-spinner`.

**Version verification:** Versions confirmed via `npm view` on 2026-04-01. All packages are current stable releases.

## Architecture Patterns

### Recommended Project Structure

```
packages/bot-harness/training/
  tui/
    dashboard.tsx         # Root <Dashboard /> component
    progress-panel.tsx    # Left column: progress bar + charts
    metrics-panel.tsx     # Right column: metrics table + pool + log
    chart.tsx             # ASCII chart wrapper component
    help-overlay.tsx      # Help overlay (D-11: h key)
    plain-logger.ts       # Non-TTY fallback: plain console.log output
    types.ts              # TUI-specific interfaces (DashboardState, etc.)
    index.ts              # Public API: renderDashboard(), renderPlainLogger()
  training-coordinator.ts # Modified: add onEpisode callback
  training-config.ts      # Modified: add --no-tui flag
bin/
  train.ts                # Modified: gate TUI vs plain based on TTY + flag
```

### Pattern 1: Callback-Driven Data Flow

**What:** Add an `onEpisode` callback to `TrainingCoordinator` that fires after each episode is logged, passing the `TrainingLogEntry` and coordinator state (pool size, etc.).
**When to use:** Every episode completion during training.
**Example:**

```typescript
// In training-coordinator.ts
export interface TrainingProgressCallback {
  (data: TrainingProgressData): void;
}

export interface TrainingProgressData {
  entry: TrainingLogEntry;
  totalEpisodes: number;
  poolSize: number;
  latestCheckpointEpisode: number | null;
  selfPlayConfig: SelfPlayConfig;
  startTime: number;
  paused: boolean;
}

// In coordinator.run() — after logEpisode:
if (this.onProgress) {
  this.onProgress({ entry, totalEpisodes, poolSize, ... });
}
```

### Pattern 2: React State from External Callbacks

**What:** Bridge coordinator callbacks to React state using a ref + setState pattern.
**When to use:** Connecting non-React event source to Ink component tree.
**Example:**

```typescript
// Source: Ink useInput/useState pattern
import React, { useState, useEffect, useRef } from 'react';
import { render, useInput, useApp } from 'ink';

const Dashboard: React.FC<{ coordinator: TrainingCoordinator }> = ({ coordinator }) => {
  const [metrics, setMetrics] = useState<TrainingProgressData | null>(null);
  const { exit } = useApp();

  useEffect(() => {
    coordinator.onProgress = (data: TrainingProgressData) => {
      setMetrics(data);
    };
    return () => { coordinator.onProgress = null; };
  }, [coordinator]);

  useInput((input, key) => {
    if (input === ' ') coordinator.togglePause();
    if (input === 'q') { coordinator.requestStop(); exit(); }
    if (key.tab) cycleView();
    if (input === 'h') toggleHelp();
  });

  return <Box flexDirection="row">...</Box>;
};
```

### Pattern 3: TTY Detection and Conditional Rendering

**What:** Gate TUI vs plain output at `bin/train.ts` entry point.
**When to use:** Always -- determines rendering mode at startup.
**Example:**

```typescript
// In bin/train.ts
const useTui = process.stdout.isTTY === true && !config.noTui;

if (useTui) {
  // Import and render Ink dashboard
  const { renderDashboard } = await import('#bot-harness');
  renderDashboard(coordinator, config);
} else {
  // Use plain console.log fallback
  const { attachPlainLogger } = await import('#bot-harness');
  attachPlainLogger(coordinator, config);
}
```

### Pattern 4: Two-Column Layout with Flexbox

**What:** Use Ink's `<Box>` with `flexDirection="row"` for side-by-side columns.
**When to use:** D-01 two-column layout on wide terminals.
**Example:**

```typescript
// Source: Ink Flexbox layout
import { Box, Text } from 'ink';

const Dashboard: React.FC<Props> = ({ metrics, width }) => {
  const twoColumn = width >= 100;

  if (twoColumn) {
    return (
      <Box flexDirection="row" width={width}>
        <Box flexDirection="column" width="50%">
          <ProgressBar current={metrics.episode} total={metrics.totalEpisodes} />
          <RewardChart data={metrics.rewardHistory} />
          <LossChart data={metrics.lossHistory} />
        </Box>
        <Box flexDirection="column" width="50%">
          <MetricsTable metrics={metrics} />
          <OpponentPool pool={metrics.poolStatus} />
          <RecentLog entries={metrics.recentEpisodes} />
        </Box>
      </Box>
    );
  }

  // Single-column fallback for narrow terminals (D-02)
  return (
    <Box flexDirection="column" width={width}>
      <ProgressBar current={metrics.episode} total={metrics.totalEpisodes} />
      <MetricsTable metrics={metrics} />
      <RewardChart data={metrics.rewardHistory} />
      <OpponentPool pool={metrics.poolStatus} />
    </Box>
  );
};
```

### Pattern 5: Pause/Resume via Coordinator Flag

**What:** Add a `paused` boolean to `TrainingCoordinator` that the run loop checks before collecting the next batch.
**When to use:** D-12 pause/resume via Space key.
**Example:**

```typescript
// In training-coordinator.ts run() loop
while (this.episodeCounter < totalEpisodes) {
  // Check pause state
  while (this.paused && !this.stopRequested) {
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  if (this.stopRequested) break;
  // ... continue batch collection
}

public togglePause(): void {
  this.paused = !this.paused;
}

public requestStop(): void {
  this.stopRequested = true;
}
```

### Anti-Patterns to Avoid

- **Direct process.stdout.write in Ink components:** Ink owns stdout. Never write to stdout directly while Ink is rendering. Use Ink's `<Text>` and `<Box>` components exclusively.
- **setInterval for TUI refresh:** Do not use `setInterval` to force re-renders. React's state-driven rendering handles updates automatically when `setState` is called from callbacks. The D-05 fixed interval should use a `useEffect` with `setInterval` that triggers a state update (e.g., incrementing a tick counter) to ensure periodic re-render even without new data.
- **Blocking the event loop in callbacks:** The `onProgress` callback runs on the main thread. Keep it synchronous and minimal (just `setState`). Do not do async I/O in the callback.
- **Using useInput without isRawModeSupported check:** Before enabling keyboard input, check `useStdin().isRawModeSupported`. In non-TTY environments, raw mode is not available.

## Don't Hand-Roll

| Problem                  | Don't Build                             | Use Instead                                             | Why                                                                         |
| ------------------------ | --------------------------------------- | ------------------------------------------------------- | --------------------------------------------------------------------------- |
| Terminal Flexbox layout  | Custom ANSI column calculations         | Ink's `<Box>` with Yoga layout                          | Yoga handles wrapping, overflow, percentage widths correctly                |
| ASCII line charts        | Custom chart renderer                   | `asciichart.plot()`                                     | Handles axis labels, auto-scaling, multi-series, padding                    |
| Keyboard input capture   | Raw stdin listener with ANSI parsing    | Ink's `useInput` hook                                   | Handles key detection, modifier keys, focus management                      |
| Terminal width detection | Manual `process.stdout.columns` polling | Ink's `useWindowSize()` hook                            | Auto-updates on terminal resize, returns `{ columns, rows }`                |
| ANSI color output        | Manual escape codes                     | Ink's `<Text color="green">` / chalk (bundled with Ink) | Consistent color support detection, graceful degradation                    |
| Component testing        | Manual stdout capture                   | `ink-testing-library` `render()` + `lastFrame()`        | Purpose-built for testing Ink components                                    |
| CI/TTY detection         | Manual `process.stdout.isTTY` check     | Ink's built-in `is-in-ci` + `interactive` option        | Ink already detects CI via `is-in-ci` package and sets `interactive: false` |

**Key insight:** Ink bundles `chalk` 5.x, `yoga-layout` 3.2, and `terminal-size` 4.0 as direct dependencies. Do not install these separately -- they are available through Ink's internals. For color in Ink components, use the `<Text color="..." />` prop rather than chalk directly.

## Common Pitfalls

### Pitfall 1: TSX/JSX Not Configured in tsconfig

**What goes wrong:** TypeScript compilation fails on `.tsx` files because `jsx` is not set in `tsconfig.json` or `tsconfig.server.json`.
**Why it happens:** The project currently uses only `.ts` files for server-side code. No `jsx` compiler option exists in any active tsconfig.
**How to avoid:** Add `"jsx": "react-jsx"` to the `compilerOptions` of `tsconfig.json` (used by ESLint for type-checking and by `vitest`). The `tsconfig.server.json` (used for `tsc` builds) also needs this if TUI files are in its include scope. The `tsx` runner handles JSX transformation automatically via esbuild, but `tsc --noEmit` and ESLint need the compiler option.
**Warning signs:** `error TS17004: Cannot use JSX unless the '--jsx' flag is provided`

### Pitfall 2: Vitest Test Include Pattern Misses TSX

**What goes wrong:** Tests in `.test.tsx` files are silently skipped by vitest.
**Why it happens:** `vitest.config.ts` has `include: ['**/*.test.ts']` which does not match `.test.tsx` files.
**How to avoid:** Update to `include: ['**/*.test.{ts,tsx}']`.
**Warning signs:** Test count doesn't increase after adding `.test.tsx` files.

### Pitfall 3: patchConsole Swallowing Coordinator Logs

**What goes wrong:** `console.log` calls from deep inside `TrainingCoordinator` or worker threads get captured by Ink's `patchConsole` and rendered as static output in the TUI.
**Why it happens:** Ink patches `console.log` by default to prevent it from corrupting the terminal layout. Any `console.log` inside the coordinator or its dependencies becomes part of Ink's output.
**How to avoid:** Use `render(<Dashboard />, { patchConsole: true })` (default) and ensure coordinator communicates exclusively through the callback mechanism, not `console.log`. Remove any remaining `console.log` calls from the coordinator's runtime path.
**Warning signs:** Random text appearing at the top of the TUI output.

### Pitfall 4: Raw Mode Crashes on Non-TTY

**What goes wrong:** `useInput` tries to enable raw mode on stdin, which throws when stdin is not a TTY.
**Why it happens:** Piped input or CI environments don't support raw mode.
**How to avoid:** The non-TTY path should never import or render Ink components. Gate the entire TUI behind the TTY check. Ink 6.x's `interactive: false` option handles this by disabling input, but the cleanest approach is to not render Ink at all in non-TTY mode and use the plain logger instead.
**Warning signs:** `Error: stdin is not a TTY` or `setRawMode is not a function`.

### Pitfall 5: Worker Thread Messages Interfere with Ink

**What goes wrong:** Worker threads writing to stdout via `console.log` can corrupt the Ink-rendered output.
**Why it happens:** Worker threads have their own stdout handle that bypasses Ink's patching.
**How to avoid:** Ensure worker threads never `console.log` during training. All worker communication should be through `postMessage`.
**Warning signs:** Garbled terminal output, partial line overwrites.

### Pitfall 6: Concurrent setState from Rapid Episode Callbacks

**What goes wrong:** If episodes complete very rapidly (e.g., 100+ per second), calling `setState` for each one can cause excessive re-rendering.
**Why it happens:** Each `setState` triggers a React re-render, and Ink has a `maxFps` setting (default unclear, likely 30).
**How to avoid:** Batch updates: accumulate episode data and only call `setState` on the fixed interval (D-05: 500ms) or debounce. Use a ref to store the latest data and a periodic `setInterval` to flush to state.
**Warning signs:** High CPU usage, flickering output, slow training.

### Pitfall 7: asciichart ESM Import

**What goes wrong:** `import asciichart from 'asciichart'` may not work because asciichart uses CommonJS.
**Why it happens:** The package predates ESM. Its `main` field points to a CJS file.
**How to avoid:** Use `import asciichart from 'asciichart'` with `esModuleInterop: true` (already set in tsconfig.base.json). The `tsx` runner and Node's ESM loader should handle CJS interop. If issues arise, use `import { plot } from 'asciichart'` or a dynamic `const asciichart = await import('asciichart')` with default extraction.
**Warning signs:** `SyntaxError: The requested module 'asciichart' does not provide an export named 'default'`

## Code Examples

### Ink render() with Options

```typescript
// Source: Ink 6.x API
import React from 'react';
import { render } from 'ink';
import { Dashboard } from './tui/dashboard.js';

const { waitUntilExit } = render(
  <Dashboard coordinator={coordinator} config={config} />,
  {
    patchConsole: true,    // Capture console.log into Ink output
    exitOnCtrlC: true,     // Ctrl+C exits cleanly
  },
);

await waitUntilExit();
```

### useInput for Key Bindings (D-10, D-11)

```typescript
// Source: Ink 6.x useInput API
import { useInput, useStdin } from 'ink';

const KeyHandler: React.FC<{
  onPause: () => void;
  onStop: () => void;
  onCycleView: () => void;
  onToggleHelp: () => void;
}> = ({ onPause, onStop, onCycleView, onToggleHelp }) => {
  const { isRawModeSupported } = useStdin();

  useInput(
    (input, key) => {
      if (input === ' ') onPause(); // Space = pause/resume
      if (input === 'q') onStop(); // q = graceful stop
      if (key.tab) onCycleView(); // Tab = cycle views
      if (input === 'h') onToggleHelp(); // h = help overlay
    },
    { isActive: isRawModeSupported },
  );

  return null; // Renders nothing, just handles input
};
```

### useWindowSize for Responsive Layout (D-02)

```typescript
// Source: Ink 6.x useWindowSize hook
import { useWindowSize } from 'ink';

const ResponsiveLayout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { columns } = useWindowSize();
  const twoColumn = columns >= 100;

  return (
    <Box flexDirection={twoColumn ? 'row' : 'column'}>
      {children}
    </Box>
  );
};
```

### asciichart Usage for D-07 Charts

```typescript
// Source: asciichart API
import asciichart from 'asciichart';

function renderRewardChart(rewardHistory: number[], width: number): string {
  const windowSize = Math.min(rewardHistory.length, 50); // D-09: last N points
  const data = rewardHistory.slice(-windowSize);

  return asciichart.plot(data, {
    height: 8,
    width: Math.floor(width / 2) - 4, // Half of available width minus padding
    format: (val: number) => val.toFixed(2).padStart(8),
  });
}

// Multi-series for policy + value loss
function renderLossChart(
  policyLoss: number[],
  valueLoss: number[],
  width: number,
): string {
  const windowSize = 50;
  return asciichart.plot(
    [policyLoss.slice(-windowSize), valueLoss.slice(-windowSize)],
    {
      height: 6,
      colors: [asciichart.blue, asciichart.red],
    },
  );
}
```

### Plain Logger Fallback (D-06)

```typescript
// Non-TTY fallback using existing formatLiveMetrics
export function attachPlainLogger(
  coordinator: TrainingCoordinator,
  config: TrainingConfig,
): void {
  const startTime = Date.now();
  const logger = coordinator.getLogger();

  coordinator.onProgress = (data: TrainingProgressData): void => {
    if (logger) {
      const line = logger.formatLiveMetrics(
        data.entry,
        config.totalEpisodes,
        startTime,
      );
      console.log(line);
    }
  };
}
```

### ink-testing-library Test Pattern

```typescript
// Source: ink-testing-library API
import { render } from 'ink-testing-library';
import React from 'react';
import { MetricsTable } from './metrics-panel.js';

describe('MetricsTable', () => {
  it('renders win rate with color', () => {
    const { lastFrame } = render(
      <MetricsTable metrics={mockMetrics} />,
    );

    expect(lastFrame()).toContain('Win Rate');
    expect(lastFrame()).toContain('65.0%');
  });
});
```

## State of the Art

| Old Approach                    | Current Approach      | When Changed | Impact                                                                         |
| ------------------------------- | --------------------- | ------------ | ------------------------------------------------------------------------------ |
| Ink 4.x with React 18           | Ink 6.x with React 19 | 2025         | New hooks (useWindowSize, useCursor), Yoga 3.2 layout, kitty keyboard protocol |
| blessed / blessed-contrib       | Ink + React           | 2020+        | blessed is unmaintained; Ink is actively developed with React ecosystem        |
| ora / cli-progress for training | Ink dashboard         | current      | Single-line spinners insufficient for multi-metric training dashboards         |
| Manual ANSI escape codes        | Ink Flexbox + Yoga    | 2019+        | Declarative layout vs imperative cursor manipulation                           |

**Deprecated/outdated:**

- `blessed` / `blessed-contrib`: Unmaintained, no React integration, complex API
- `import-jsx`: Superseded by `tsx` runner which handles JSX natively via esbuild
- `@esbuild-kit/esm-loader`: Deprecated in favor of `tsx`
- Ink 3.x/4.x: Old versions; Ink 6.x is current with React 19 support

## Open Questions

1. **asciichart width parameter behavior**
   - What we know: `asciichart.plot()` auto-sizes width to data length. There is mention of a `width` option but it may not exist in v1.5.25 (the TS types may clarify).
   - What's unclear: Whether chart width can be constrained to fit within a column. May need to truncate/sample data to control width.
   - Recommendation: Test `asciichart.plot()` with the `height` option (confirmed to work) and control width by limiting data array length to desired column width. This is actually the standard approach -- data array length = chart width.

2. **Ink maxFps and rendering throttle**
   - What we know: Ink has a `maxFps` render option. Default behavior throttles re-renders.
   - What's unclear: Exact default value and whether it's sufficient for the D-05 500ms interval.
   - Recommendation: Accept defaults; the 500ms interval is well within any reasonable FPS cap. Only tune if flickering observed.

3. **TrainingCoordinator async pause/resume**
   - What we know: The coordinator's `run()` method is a single async function with a while loop. Adding a pause check requires polling.
   - What's unclear: Whether the `await new Promise(resolve => setTimeout(resolve, 100))` poll pattern is clean enough or if an event-based approach is better.
   - Recommendation: The polling approach is simple and sufficient. The coordinator already does heavy async work (worker management), so a 100ms poll during pause has negligible overhead.

## Validation Architecture

### Test Framework

| Property           | Value                                                  |
| ------------------ | ------------------------------------------------------ |
| Framework          | vitest 4.0.18                                          |
| Config file        | `vitest.config.ts` (needs `include` update for `.tsx`) |
| Quick run command  | `npx vitest run packages/bot-harness/training/tui`     |
| Full suite command | `npm run test:unit`                                    |

### Phase Requirements -> Test Map

| Req ID | Behavior                                  | Test Type | Automated Command                                                              | File Exists?    |
| ------ | ----------------------------------------- | --------- | ------------------------------------------------------------------------------ | --------------- |
| TUI-01 | Dashboard renders with all metric fields  | unit      | `npx vitest run packages/bot-harness/training/tui/dashboard.test.tsx -x`       | Wave 0          |
| TUI-02 | Time-per-gen and throughput displayed     | unit      | `npx vitest run packages/bot-harness/training/tui/metrics-panel.test.tsx -x`   | Wave 0          |
| TUI-03 | Plain log fallback when not TTY           | unit      | `npx vitest run packages/bot-harness/training/tui/plain-logger.test.ts -x`     | Wave 0          |
| TUI-04 | --no-tui flag parsed by parseTrainingArgs | unit      | `npx vitest run packages/bot-harness/training/training-config.test.ts -x`      | Exists (extend) |
| TUI-05 | ASCII charts render with sample data      | unit      | `npx vitest run packages/bot-harness/training/tui/chart.test.tsx -x`           | Wave 0          |
| TUI-06 | Keyboard input: space/q/tab/h handled     | unit      | `npx vitest run packages/bot-harness/training/tui/dashboard.test.tsx -x`       | Wave 0          |
| TUI-07 | Coordinator onProgress callback fires     | unit      | `npx vitest run packages/bot-harness/training/training-coordinator.test.ts -x` | Exists (extend) |
| TUI-08 | Two-column layout at width >= 100         | unit      | `npx vitest run packages/bot-harness/training/tui/dashboard.test.tsx -x`       | Wave 0          |
| TUI-09 | Single-column fallback at width < 100     | unit      | `npx vitest run packages/bot-harness/training/tui/dashboard.test.tsx -x`       | Wave 0          |

### Sampling Rate

- **Per task commit:** `npx vitest run packages/bot-harness/training/tui -x`
- **Per wave merge:** `npm run test:unit`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] `packages/bot-harness/training/tui/dashboard.test.tsx` -- covers TUI-01, TUI-06, TUI-08, TUI-09
- [ ] `packages/bot-harness/training/tui/metrics-panel.test.tsx` -- covers TUI-02
- [ ] `packages/bot-harness/training/tui/chart.test.tsx` -- covers TUI-05
- [ ] `packages/bot-harness/training/tui/plain-logger.test.ts` -- covers TUI-03
- [ ] `vitest.config.ts` update: `include: ['**/*.test.{ts,tsx}']`
- [ ] `tsconfig.json` update: add `"jsx": "react-jsx"` to compilerOptions
- [ ] Framework install: `npm install ink react @types/react asciichart @types/asciichart && npm install -D ink-testing-library`

## Sources

### Primary (HIGH confidence)

- npm registry: `ink@6.8.0` -- version, peer deps, dependencies verified via `npm view`
- npm registry: `react@19.2.4`, `@types/react@19.2.14` -- version verified
- npm registry: `asciichart@1.5.25`, `@types/asciichart@1.5.8` -- version verified
- npm registry: `ink-testing-library@4.0.0` -- version and peer deps verified
- npm registry: `ink-spinner@5.0.0` -- version and peer deps verified
- [Ink GitHub README](https://github.com/vadimdemedes/ink) -- API: render(), useInput(), useWindowSize(), useApp(), useStdin(), Box, Text components
- [Ink GitHub issue #166](https://github.com/vadimdemedes/ink/issues/166) -- raw mode TTY handling
- [asciichart GitHub](https://github.com/kroitor/asciichart) -- plot() API, multi-series, color support

### Secondary (MEDIUM confidence)

- [Ink npm page](https://www.npmjs.com/package/ink) -- `interactive` option defaults to `false` on CI/non-TTY, `patchConsole` default behavior
- [TUI Development: Ink + React (2025)](https://combray.prose.sh/2025-12-01-tui-development) -- Ink 6 patterns and hooks
- [ink-chart GitHub](https://github.com/pppp606/ink-chart) -- alternative chart library evaluated but not recommended

### Tertiary (LOW confidence)

- asciichart `width` option -- not confirmed in types, needs validation during implementation

## Metadata

**Confidence breakdown:**

- Standard stack: HIGH - all versions confirmed via npm registry, peer dependencies validated
- Architecture: HIGH - based on Ink's documented API (render, useInput, Box/Text), existing coordinator code structure analyzed
- Pitfalls: HIGH - TSX/JSX config gap verified by examining all tsconfig files; vitest include pattern confirmed; Ink TTY behavior documented in GitHub issues
- Charts: MEDIUM - asciichart API confirmed for basic use; width control via data length is standard but not explicitly documented

**Research date:** 2026-04-01
**Valid until:** 2026-05-01 (stable libraries, low churn)
