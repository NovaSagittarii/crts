# Requirements: Conway RTS v0.0.4

**Defined:** 2026-03-30
**Core Value:** Two players can quickly get into a match and use Conway-based strategy to defend their safe cell and breach the opponent's.

## v0.0.4 Requirements

Requirements for RL Bot Harness & Balance Analysis milestone.

### Bot Harness

- [x] **HARN-01**: Headless match runner executes a full match between two bot agents using RtsRoom API without Socket.IO
- [x] **HARN-02**: Observation encoder extracts grid feature planes and scalar features from RoomState into a tensor-compatible format
- [x] **HARN-03**: Action decoder maps discrete action indices to valid build/destroy queue calls with action masking for invalid placements
- [x] **HARN-04**: Reward signal computes win/loss outcome reward plus shaped intermediate rewards (economy, territory, structure health) with configurable annealing

### Training

- [x] **TRAIN-01**: PPO training loop runs policy gradient updates against headless matches using TF.js (with Python/SB3 decision gate)
- [x] **TRAIN-02**: Self-play system maintains an opponent pool of historical checkpoints to prevent mode collapse
- [x] **TRAIN-03**: Training CLI launches configurable training runs (episodes, learning rate, opponent pool size) from the command line
- [x] **TRAIN-04**: Training step parallelizes match simulations across worker threads to utilize multiple CPU cores

### Balance Analysis

- [x] **BAL-01**: Match database logs match outcomes, build orders, and per-tick snapshots from headless simulations
- [x] **BAL-02**: Win rate analysis computes per-template and per-strategy win rates from the match database
- [x] **BAL-03**: Strategy distribution classifier identifies and tracks build-order archetypes across training generations
- [x] **BAL-04**: Glicko-2 rating engine rates individual structure templates and template combinations from match outcomes
- [x] **BAL-05**: Balance report CLI generates summary reports (win rates, ratings, strategy meta, heatmaps) from match data

### Deployment

- [x] **DEPLOY-01**: Socket.IO bot adapter connects a trained model to a live game server as a virtual player

### Performance

- [x] **PERF-01**: Centralized TF.js backend loader dynamically imports @tensorflow/tfjs-node with automatic fallback to @tensorflow/tfjs pure JS
- [x] **PERF-02**: All training code (PPOTrainer, TrainingCoordinator, workers) uses the shared backend loader with no hardcoded @tensorflow/tfjs imports
- [x] **PERF-03**: All inference code (LiveBotStrategy, model-loader) uses the shared backend loader with no hardcoded @tensorflow/tfjs imports

### Training TUI Dashboard

- [x] **TUI-01**: Dashboard renders live-updating display with generation number, episode count, win rate, policy/value loss, entropy, and ETA
- [x] **TUI-02**: Time-per-generation and throughput (episodes/sec) are displayed and updated each generation
- [x] **TUI-03**: Dashboard degrades gracefully to plain log lines when stdout is not a TTY (e.g. CI, piped output)
- [x] **TUI-04**: Training CLI bin/train.ts activates TUI by default with --no-tui flag to disable
- [x] **TUI-05**: ASCII line charts render reward trends and policy/value loss in the dashboard
- [x] **TUI-06**: Keyboard input handles pause/resume (Space), graceful stop (q), view cycling (Tab), and help (h)
- [x] **TUI-07**: TrainingCoordinator emits per-episode progress data via callback mechanism
- [x] **TUI-08**: Two-column layout activates at terminal width >= 100 columns
- [x] **TUI-09**: Single-column stacked layout used for terminal width < 100 columns

### Training Pipeline CPU Utilization

- [ ] **PIPE-01**: Workers begin collecting the next batch of episodes while the main thread runs PPO gradient updates on the current batch (double-buffering)
- [ ] **PIPE-02**: Weight broadcast to workers overlaps with late-finishing episode collection from the previous batch
- [ ] **PIPE-03**: Pipeline metrics (episodes/sec, pipeline efficiency) are computed per generation and reported via onProgress
- [ ] **PIPE-04**: Training throughput (episodes/sec) measurably improves compared to the synchronous baseline

## Future Requirements

Deferred to future milestones.

### Advanced Training

- **TRAIN-05**: Curriculum learning with progressive difficulty stages
- **TRAIN-06**: Multi-agent tournament brackets for ELO convergence
- **TRAIN-07**: Hyperparameter search automation

### Advanced Analysis

- **BAL-06**: Per-map balance heatmaps showing territorial advantage
- **BAL-07**: Counter-strategy detection (rock-paper-scissors dynamics)

## Out of Scope

| Feature                             | Reason                                                                                  |
| ----------------------------------- | --------------------------------------------------------------------------------------- |
| Client-predicted bot moves          | Bots use server-authoritative path only                                                 |
| GPU training acceleration           | Pure JS CPU sufficient for game's small observation space; revisit if training too slow |
| Visual replay of bot matches        | Headless analysis only; human spectating deferred                                       |
| Custom neural network architectures | Use standard MLP/small CNN; architecture search is research-level                       |
| Real-time balance dashboard         | CLI reports sufficient for v0.0.4                                                       |

## Traceability

| Requirement | Phase    | Status   |
| ----------- | -------- | -------- |
| HARN-01     | Phase 18 | Complete |
| HARN-02     | Phase 19 | Complete |
| HARN-03     | Phase 19 | Complete |
| HARN-04     | Phase 19 | Complete |
| TRAIN-01    | Phase 20 | Complete |
| TRAIN-02    | Phase 20 | Complete |
| TRAIN-03    | Phase 20 | Complete |
| TRAIN-04    | Phase 20 | Complete |
| BAL-01      | Phase 18 | Complete |
| BAL-02      | Phase 21 | Complete |
| BAL-03      | Phase 21 | Complete |
| BAL-04      | Phase 22 | Complete |
| BAL-05      | Phase 22 | Complete |
| DEPLOY-01   | Phase 23 | Complete |
| PERF-01     | Phase 24 | Complete |
| PERF-02     | Phase 24 | Complete |
| PERF-03     | Phase 24 | Complete |
| TUI-01      | Phase 25 | Planned  |
| TUI-02      | Phase 25 | Planned  |
| TUI-03      | Phase 25 | Planned  |
| TUI-04      | Phase 25 | Planned  |
| TUI-05      | Phase 25 | Planned  |
| TUI-06      | Phase 25 | Planned  |
| TUI-07      | Phase 25 | Planned  |
| TUI-08      | Phase 25 | Planned  |
| TUI-09      | Phase 25 | Planned  |
| PIPE-01     | Phase 26 | Planned  |
| PIPE-02     | Phase 26 | Planned  |
| PIPE-03     | Phase 26 | Planned  |
| PIPE-04     | Phase 26 | Planned  |

**Coverage:**

- v0.0.4 requirements: 30 total
- Mapped to phases: 30
- Unmapped: 0

---

_Requirements defined: 2026-03-30_
_Last updated: 2026-04-03 after Phase 26 planning_
