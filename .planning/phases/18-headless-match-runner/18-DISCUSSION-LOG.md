# Phase 18: Headless Match Runner - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-01
**Phase:** 18-headless-match-runner
**Areas discussed:** Bot agent contract, Match logging format, Headless lifecycle, Runner CLI / API

---

## Bot Agent Contract

### Q1: How should bot agents plug into the match runner?

| Option | Description | Selected |
|--------|-------------|----------|
| Strategy interface | Define a BotStrategy interface with decideTick(state, teamId) method returning build/destroy actions. Runner calls it each tick. Clean seam for Phase 19. | ✓ |
| Callback per tick | Runner accepts a plain function (state, teamId) => actions[]. Simpler but less structured. | |
| You decide | Let Claude choose based on downstream needs. | |

**User's choice:** Strategy interface
**Notes:** Clean contract for Phase 19 Gymnasium wrapper.

### Q2: What built-in bot strategies should ship with Phase 18?

| Option | Description | Selected |
|--------|-------------|----------|
| Random only | A RandomBot that places valid random structures each tick. Minimal. | |
| Random + do-nothing | RandomBot plus a NoOpBot (never builds). Useful as baseline opponent. | ✓ |
| Random + scripted | RandomBot plus a simple scripted bot. More variety but more scope. | |

**User's choice:** Random + do-nothing
**Notes:** NoOpBot useful for win-rate sanity checks.

### Q3: Should bots decide every tick, or on a configurable interval?

| Option | Description | Selected |
|--------|-------------|----------|
| Every tick | Bot decides every tick. Simple, deterministic. | ✓ |
| Configurable interval | Runner calls bot every N ticks. | |
| You decide | Claude picks. | |

**User's choice:** Every tick
**Notes:** Phase 19 can throttle its own frequency.

### Q4: Should the bot see full RoomState or a filtered observation?

| Option | Description | Selected |
|--------|-------------|----------|
| Full RoomState | Pass raw RoomState. Phase 19 adds observation encoder. | |
| Filtered view | Pass only team-visible state (hide enemy internals). | ✓ |

**User's choice:** Filtered view

### Q5: What level of filtering for the bot's view?

| Option | Description | Selected |
|--------|-------------|----------|
| Own team state only | Full grid but only own team's economy, structures, build queue. | ✓ |
| Fog of war radius | Only sees grid cells within radius of structures. | |
| Team-scoped RoomState | TeamView object with own team details + shared grid. | |

**User's choice:** Own team state only
**Notes:** Grid is inherently visible in Conway. Opponent team internals (resources, queue) hidden.

---

## Match Logging Format

### Q1: What granularity for NDJSON match logs?

| Option | Description | Selected |
|--------|-------------|----------|
| Summary + tick snapshots | One NDJSON file per match. Metadata, per-tick snapshots, outcome. | ✓ |
| Summary only | One JSON object per match. Smaller but no tick-level data. | |
| Full state per tick | Full grid + team state every tick. Maximum fidelity, large files. | |

**User's choice:** Summary + tick snapshots

### Q2: How should match log files be organized?

| Option | Description | Selected |
|--------|-------------|----------|
| Directory per run | matches/<run-id>/match-<N>.ndjson | ✓ |
| Flat directory | matches/match-<timestamp>-<seed>.ndjson | |
| You decide | Claude chooses. | |

**User's choice:** Directory per run

### Q3: Should per-tick snapshots include build orders?

| Option | Description | Selected |
|--------|-------------|----------|
| Yes, full build orders | Template, position, transform, result per tick. | ✓ |
| Actions only, no positions | Which templates built/destroyed but not coordinates. | |

**User's choice:** Yes, full build orders

### Q4: Should the match log include a determinism hash per tick?

| Option | Description | Selected |
|--------|-------------|----------|
| Yes | fnv1a-32 hash every N ticks for offline verification. | ✓ |
| No | Skip hash trail. | |
| You decide | Claude picks. | |

**User's choice:** Yes

---

## Headless Lifecycle

### Q1: How should the headless runner handle the lifecycle?

| Option | Description | Selected |
|--------|-------------|----------|
| Skip to active | Create room, add players, start ticking directly. | ✓ |
| Fast-forward lifecycle | Trigger full lifecycle transitions programmatically. | |
| You decide | Claude picks. | |

**User's choice:** Skip to active

### Q2: Should headless matches have a tick limit?

| Option | Description | Selected |
|--------|-------------|----------|
| Yes, configurable with default | Default max ticks, configurable per run. Draw if limit hit. | ✓ |
| No limit | Run until natural conclusion. | |
| You decide | Claude picks. | |

**User's choice:** Yes, configurable with default

### Q3: Where should the headless match runner code live?

| Option | Description | Selected |
|--------|-------------|----------|
| New package: packages/bot-harness | Separate package, clean boundary. | ✓ |
| Inside packages/rts-engine | Add alongside existing engine code. | |
| New app: apps/bot-runner | Treat as runtime app. | |

**User's choice:** New package: packages/bot-harness

### Q4: Should the runner emit events?

| Option | Description | Selected |
|--------|-------------|----------|
| Simple callbacks | Optional onMatchComplete/onTickComplete callbacks. | ✓ |
| EventEmitter | Typed EventEmitter. | |
| You decide | Claude picks. | |

**User's choice:** Simple callbacks

---

## Runner CLI / API

### Q1: Should Phase 18 include a CLI entry point?

| Option | Description | Selected |
|--------|-------------|----------|
| Yes, simple CLI | bin/run-matches.ts with flags. | ✓ |
| Programmatic API only | No CLI, tests exercise API. | |
| You decide | Claude decides. | |

**User's choice:** Yes, simple CLI

### Q2: How should batch runs be parallelized?

| Option | Description | Selected |
|--------|-------------|----------|
| Sequential in Phase 18 | One at a time. Phase 20 adds worker_threads. | ✓ |
| Parallel from the start | worker_threads now. | |

**User's choice:** Sequential in Phase 18

### Q3: Should the CLI support a --dry-run mode?

| Option | Description | Selected |
|--------|-------------|----------|
| Yes | Run without persisting logs. | ✓ |
| No | Always persist. | |
| You decide | Claude picks. | |

**User's choice:** Yes

### Q4: Should seed control support auto-incrementing?

| Option | Description | Selected |
|--------|-------------|----------|
| Base seed + increment | --seed 42 with --count 10 → seeds 42-51. | ✓ |
| Random seeds, log them | Random per match, recorded in logs. | |

**User's choice:** Base seed + increment

---

## Claude's Discretion

- Default max tick limit value
- Hash checkpoint interval
- Exact NDJSON field names and schema
- Internal package structure within packages/bot-harness
- CLI parsing library choice

## Deferred Ideas

None — discussion stayed within phase scope
