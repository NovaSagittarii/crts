# Phase 24: TF.js Native Backend with Dynamic Fallback - Research

**Researched:** 2026-04-01
**Domain:** TensorFlow.js backend selection, dynamic import, Node.js native addon fallback
**Confidence:** HIGH

## Summary

This phase replaces hardcoded `import * as tf from '@tensorflow/tfjs'` statements across 12 files in `packages/bot-harness/` with a centralized backend loader that attempts `@tensorflow/tfjs-node` (native C++ acceleration) first, falling back to `@tensorflow/tfjs` (pure JS CPU) when the native addon fails. The API surface is identical between both packages -- `tfjs-node` re-exports all of `@tensorflow/tfjs` plus registers a faster backend and adds a `tf.node` namespace. This means the swap is transparent to all consuming code.

The primary challenge is that this project runs on Alpine Linux with musl libc, where `@tensorflow/tfjs-node@4.22.0` fails with `Error relocating libtensorflow.so.2: __memcpy_chk: symbol not found`. Even with `gcompat` installed (which is present on this system), the native addon cannot load. This was verified during research by attempting to load tfjs-node on the target system. The dynamic import fallback pattern was also verified to work correctly on this system -- `import('@tensorflow/tfjs-node')` throws, the catch block loads `import('@tensorflow/tfjs')`, and the returned module provides the full TF.js API.

Additionally, `@tensorflow/tfjs-node@4.22.0` has a known compatibility issue with Node.js 24 (the version used in this project). A fix was merged in April 2025 (PR #8425) but no new npm release has been published. This means on environments where the native addon could work (glibc-based Linux), it may still fail on Node 24. The fallback mechanism is therefore doubly important.

**Primary recommendation:** Create a single `packages/bot-harness/tf-backend.ts` module that exports `getTf()` returning a cached `Promise<typeof import('@tensorflow/tfjs')>`. All 12 files that currently import `@tensorflow/tfjs` directly should import from this module instead. Add `@tensorflow/tfjs-node` as an `optionalDependency` in `package.json`.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
None -- discuss phase was skipped per workflow.skip_discuss. All implementation choices at Claude's discretion.

### Claude's Discretion
All implementation choices are at Claude's discretion -- discuss phase was skipped per user setting. Use ROADMAP phase goal, success criteria, and codebase conventions to guide decisions.

### Deferred Ideas (OUT OF SCOPE)
None -- discuss phase skipped.
</user_constraints>

## Project Constraints (from CLAUDE.md)

- Strict TypeScript mode; avoid `any`
- Explicit `.js` extensions in relative imports
- Explicit return types for exported functions
- Interfaces for object shapes; type aliases for unions
- Keep `npm run lint` passing (ESLint + `typescript-eslint` `recommendedTypeChecked`)
- `packages/*` must never import from `apps/*` or use Socket.IO/Express/DOM APIs
- Import aliases: `#conway-core`, `#rts-engine`, `#bot-harness`
- Conventional Commits
- Co-located unit tests in `packages/*`
- `module: "NodeNext"` with `moduleResolution: "NodeNext"` in tsconfig

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@tensorflow/tfjs` | 4.22.0 (stable) / 4.23.0-rc.0 (currently installed) | Pure JS TF.js CPU backend -- guaranteed fallback | Already installed; works on all platforms |
| `@tensorflow/tfjs-node` | 4.22.0 | Native TF C++ backend for faster training/inference | 10-30x faster for large tensor ops; standard for Node.js ML |

### Version Notes
- The project currently pins `@tensorflow/tfjs@^4.23.0-rc.0` in package.json. The stable release is 4.22.0. These are API-compatible.
- `@tensorflow/tfjs-node@4.22.0` is the latest published npm release. It has a known Node 24 issue (fix merged but unreleased). On Alpine musl, the native binary fails regardless of Node version.
- When `@tensorflow/tfjs-node` loads successfully, it bundles its own copy of `@tensorflow/tfjs` internally -- no version mismatch risk if both are at 4.22.0.

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| optionalDependencies for tfjs-node | Conditional npm install script | More complex, less npm-idiomatic |
| Single tf-backend.ts loader | Per-file dynamic imports | Code duplication, harder to test, no centralized logging |
| Async getTf() | Top-level await in each file | Blocks module loading, less control over error handling |

**Installation:**
```bash
# tfjs-node as optional dependency (won't fail install if native build fails)
npm install --save-optional @tensorflow/tfjs-node@4.22.0
```

## Architecture Patterns

### Recommended Project Structure
```
packages/bot-harness/
  tf-backend.ts              # NEW: centralized backend loader
  tf-backend.test.ts         # NEW: unit test for backend loader
  live-bot-strategy.ts       # MODIFY: import from tf-backend.ts
  model-loader.ts            # MODIFY: import from tf-backend.ts
  training/
    ppo-trainer.ts            # MODIFY: import from tf-backend.ts
    ppo-network.ts            # MODIFY: import from tf-backend.ts
    training-coordinator.ts   # MODIFY: import from tf-backend.ts
    training-worker.ts        # MODIFY: import from tf-backend.ts (or keep pure JS -- see below)
    tfjs-file-io.ts           # MODIFY: import from tf-backend.ts
    opponent-pool.ts          # MINIMAL: type-only import, may not need change
```

### Pattern 1: Centralized Backend Loader (`tf-backend.ts`)
**What:** A singleton async loader that tries `@tensorflow/tfjs-node` first, falls back to `@tensorflow/tfjs`, caches the result, and logs which backend was selected.
**When to use:** Every file that needs `tf` at runtime.
**Example:**
```typescript
// packages/bot-harness/tf-backend.ts
import type * as tfTypes from '@tensorflow/tfjs';

export type TfModule = typeof tfTypes;

let _cached: TfModule | null = null;
let _backendName: 'native' | 'cpu' = 'cpu';

/**
 * Load TensorFlow.js with native backend preference.
 *
 * Tries @tensorflow/tfjs-node first (native C++ acceleration).
 * Falls back to @tensorflow/tfjs (pure JS CPU) if native fails.
 * Result is cached after first call.
 */
export async function getTf(): Promise<TfModule> {
  if (_cached !== null) return _cached;

  try {
    const mod = await import('@tensorflow/tfjs-node');
    _cached = mod as unknown as TfModule;
    _backendName = 'native';
  } catch {
    const mod = await import('@tensorflow/tfjs');
    _cached = mod as unknown as TfModule;
    _backendName = 'cpu';
  }

  return _cached;
}

/**
 * Returns which backend was loaded: 'native' or 'cpu'.
 * Only meaningful after getTf() has been called.
 */
export function getBackendName(): 'native' | 'cpu' {
  return _backendName;
}
```

### Pattern 2: Consumer Migration Pattern
**What:** Each file that currently does `import * as tf from '@tensorflow/tfjs'` changes to receive `tf` via `getTf()` at initialization time.
**When to use:** All 12 files listed above.

There are two sub-patterns depending on the file's structure:

**Sub-pattern A: Class-based files (PPOTrainer, LiveBotStrategy, etc.)**
These already have initialization points (constructors, `init()` methods). Pass `tf` as a parameter or load it in an async factory:

```typescript
// Before:
import * as tf from '@tensorflow/tfjs';
export class PPOTrainer {
  constructor(model: tf.LayersModel, config: TrainingConfig) { ... }
}

// After -- option 1: pass tf in constructor
import type { TfModule } from './tf-backend.js';
export class PPOTrainer {
  private readonly tf: TfModule;
  constructor(tf: TfModule, model: unknown, config: TrainingConfig) {
    this.tf = tf;
    // ...
  }
}

// After -- option 2 (RECOMMENDED): module-level init + lazy reference
import { getTf } from './tf-backend.js';
import type { TfModule } from './tf-backend.js';

let tf: TfModule;

export async function initTf(): Promise<void> {
  tf = await getTf();
}

// Rest of file uses `tf` as before -- minimal code changes
```

**Sub-pattern B: Worker threads (`training-worker.ts`)**
Workers run in a separate V8 isolate and MUST initialize their own TF.js backend. The worker should call `getTf()` during its init handler. Since workers currently use pure JS only (by design), they can either:
1. Also use `getTf()` for consistency (getting native if available)
2. Continue importing `@tensorflow/tfjs` directly (keeping the known-safe pure JS path)

**Recommendation:** Use `getTf()` in workers too, for consistency. The native backend works fine in worker threads on glibc systems; on Alpine it falls back automatically.

### Pattern 3: Type-Only Imports
**What:** Files that only need TF.js types (like `opponent-pool.ts` which does `import type * as tf from '@tensorflow/tfjs'`) can continue using type-only imports from `@tensorflow/tfjs` directly.
**When to use:** When the file uses TF.js only for type annotations, never for runtime operations.

**Key insight:** `import type` is erased at compile time and causes no runtime loading. No change needed for type-only imports unless they need to reference the `TfModule` type alias for consistency.

### Anti-Patterns to Avoid
- **Importing from both `@tensorflow/tfjs` AND `@tensorflow/tfjs-node` in the same file:** This can cause backend conflicts. Always go through `getTf()`.
- **Using top-level `await import()` in module scope:** Blocks module loading, hard to handle errors cleanly. Use the centralized loader pattern instead.
- **Passing `tf` through deep call chains as a parameter:** This would require refactoring every function signature. Use the module-level cached reference pattern instead.
- **Making `@tensorflow/tfjs-node` a hard dependency:** Install will fail in CI/Alpine environments. Use `optionalDependencies`.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Backend detection | Custom platform-sniffing (musl check, Node version check) | Dynamic `import()` try/catch | Let the native addon fail naturally; catches ALL failure modes |
| TF.js file I/O | New file handler for native backend | Keep existing `tfjs-file-io.ts` | Custom IO works with both backends; `file://` handler in tfjs-node is bonus, not requirement |
| Backend switching at runtime | Hot-swapping between native and JS backends | One-time selection at startup | TF.js doesn't cleanly support switching backends after tensors are created |

**Key insight:** The dynamic import fallback is the entire "detection" mechanism. No need to check `process.platform`, libc version, or anything else. If `import('@tensorflow/tfjs-node')` succeeds, native is available. If it throws, it isn't.

## Common Pitfalls

### Pitfall 1: Stale Module Cache With Both Packages Installed
**What goes wrong:** If `@tensorflow/tfjs-node` is installed as an optional dep and `@tensorflow/tfjs` as a regular dep, Node.js may cache the pure JS backend registration from an earlier import, and the native backend never takes precedence.
**Why it happens:** `@tensorflow/tfjs-node` internally imports `@tensorflow/tfjs` and then registers its native backend on top. But if `@tensorflow/tfjs` was already imported and its CPU backend registered, there could be ordering issues.
**How to avoid:** Ensure `getTf()` is called BEFORE any other code imports `@tensorflow/tfjs`. The centralized loader pattern guarantees this -- no file imports `@tensorflow/tfjs` directly anymore.
**Warning signs:** `tf.getBackend()` returns `'cpu'` even when `@tensorflow/tfjs-node` loaded without error.

### Pitfall 2: Worker Thread Backend Initialization
**What goes wrong:** Workers are separate V8 isolates. They don't inherit the main thread's backend. Each worker must independently load and initialize TF.js.
**Why it happens:** Worker threads share memory for `SharedArrayBuffer` but not module state.
**How to avoid:** Call `getTf()` in the worker's init handler before any tensor operations.
**Warning signs:** Workers crash with "No backend found in registry" or silently use CPU even when main thread uses native.

### Pitfall 3: TypeScript Type Compatibility Between Packages
**What goes wrong:** `tf.LayersModel` from `@tensorflow/tfjs-node` is technically a different type than from `@tensorflow/tfjs` in strict TypeScript.
**Why it happens:** The packages have separate type declarations even though they're API-compatible.
**How to avoid:** Use `import type * as tf from '@tensorflow/tfjs'` for all TYPE annotations. Use the runtime `getTf()` return for all VALUE usage. The `TfModule` type alias from `tf-backend.ts` provides the canonical type.
**Warning signs:** TypeScript errors like "Type 'LayersModel' is not assignable to type 'LayersModel'" -- same name, different declaration sources.

### Pitfall 4: Async Initialization Race
**What goes wrong:** Multiple files call `getTf()` concurrently during startup, potentially causing multiple simultaneous `import()` calls before the cache is populated.
**Why it happens:** The cache check and assignment aren't atomic.
**How to avoid:** Use a promise-based cache (store the pending promise, not just the result) to ensure only one `import()` call is made:
```typescript
let _promise: Promise<TfModule> | null = null;

export function getTf(): Promise<TfModule> {
  if (_promise === null) {
    _promise = loadBackend();
  }
  return _promise;
}
```
**Warning signs:** Console shows "Using native backend" AND "Falling back to CPU backend" logs from the same process.

### Pitfall 5: Node 24 + tfjs-node Breakage
**What goes wrong:** On glibc systems with Node 24, `@tensorflow/tfjs-node@4.22.0` may fail due to a known compatibility bug.
**Why it happens:** The fix (PR #8425) was merged but never released to npm.
**How to avoid:** The fallback mechanism handles this automatically -- if native fails for ANY reason (musl, Node 24, etc.), pure JS kicks in.
**Warning signs:** Native backend fails on a glibc system where it previously worked after a Node upgrade.

## Code Examples

### Backend Loader (Verified Pattern)
```typescript
// Verified working on Alpine Linux 3.24 / Node 24.13.0 / musl libc
// Dynamic import fallback confirmed: native throws, pure JS loads successfully

import type * as tfTypes from '@tensorflow/tfjs';

export type TfModule = typeof tfTypes;

let _promise: Promise<TfModule> | null = null;
let _backendName: 'native' | 'cpu' = 'cpu';

async function loadBackend(): Promise<TfModule> {
  try {
    const mod = await import('@tensorflow/tfjs-node');
    _backendName = 'native';
    return mod as unknown as TfModule;
  } catch {
    const mod = await import('@tensorflow/tfjs');
    _backendName = 'cpu';
    return mod;
  }
}

export function getTf(): Promise<TfModule> {
  if (_promise === null) {
    _promise = loadBackend();
  }
  return _promise;
}

export function getBackendName(): 'native' | 'cpu' {
  return _backendName;
}
```

### Consumer File Migration Example
```typescript
// Before (ppo-network.ts):
import * as tf from '@tensorflow/tfjs';

export function buildPPOModel(config: PPOModelConfig): tf.LayersModel {
  const planeInput = tf.input({ shape: [...], name: 'planes' });
  // ...
}

// After (ppo-network.ts):
import { getTf } from './tf-backend.js';
import type { TfModule } from './tf-backend.js';
import type * as tf from '@tensorflow/tfjs'; // for type annotations only

let _tf: TfModule;

/** Must be called before any other function in this module. */
export async function initTfBackend(): Promise<void> {
  _tf = await getTf();
}

export function buildPPOModel(config: PPOModelConfig): tf.LayersModel {
  const planeInput = _tf.input({ shape: [...], name: 'planes' });
  // ...
}
```

### Package.json Change
```json
{
  "dependencies": {
    "@tensorflow/tfjs": "^4.22.0"
  },
  "optionalDependencies": {
    "@tensorflow/tfjs-node": "^4.22.0"
  }
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Hardcoded `import * as tf from '@tensorflow/tfjs'` | Dynamic import with fallback via centralized loader | Phase 24 | Enables native acceleration where available; pure JS otherwise |
| `@tensorflow/tfjs-node` as hard dependency | `optionalDependencies` with fallback | Standard practice since tfjs-node install failures became widespread (~2023) | Install never fails; performance degrades gracefully |
| Synchronous `require()` with try/catch | Async `import()` with try/catch | ESM migration | Required for `"type": "module"` projects |

**Deprecated/outdated:**
- `@tensorflow/tfjs-node@4.22.0`: Last release over a year ago. Node 24 fix merged but unreleased. Still the best available option.
- `file://` IO handler: Only in tfjs-node. This project already has custom `tfjs-file-io.ts` that works with both backends. No need to switch.

## Open Questions

1. **Should workers use getTf() or keep hardcoded pure JS?**
   - What we know: Workers currently hardcode `@tensorflow/tfjs` with a comment: "CRITICAL: This file imports @tensorflow/tfjs (pure JS), NEVER the native addon variant."
   - What's unclear: The comment from Phase 20 says native addon "crashes in worker threads" -- but this may have been specific to the Alpine musl issue, not a general worker thread limitation. On glibc systems, tfjs-node should work fine in workers.
   - Recommendation: Use `getTf()` in workers too. The comment was written when tfjs-node was a hard dependency that would crash the entire process. With the dynamic fallback, the worst case is falling back to pure JS -- the same behavior as today.

2. **Version alignment: 4.23.0-rc.0 vs 4.22.0**
   - What we know: `@tensorflow/tfjs@4.23.0-rc.0` is currently installed. `@tensorflow/tfjs-node@4.22.0` is the latest stable. There's no 4.23.0-rc.0 of tfjs-node.
   - What's unclear: Whether mixing 4.23.0-rc.0 (pure JS) with 4.22.0 (native) causes issues.
   - Recommendation: Pin both to `4.22.0` (stable) for consistency. The rc.0 was likely used because it was the only version available at Phase 20 time. If there's a specific reason for rc.0, this can be reconsidered.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `@tensorflow/tfjs` | All TF.js operations | Yes | 4.23.0-rc.0 (installed) | -- (core dependency) |
| `@tensorflow/tfjs-node` | Native acceleration | No (not installed) | 4.22.0 (latest npm) | `@tensorflow/tfjs` pure JS CPU |
| Node.js | Runtime | Yes | 24.13.0 | -- |
| musl libc | Alpine OS | Yes (system libc) | -- | Blocks tfjs-node native binary |
| gcompat | glibc compat layer | Yes | 1.1.0-r4 | -- (installed but insufficient for tfjs-node) |

**Missing dependencies with no fallback:**
- None -- the entire point of this phase is graceful degradation.

**Missing dependencies with fallback:**
- `@tensorflow/tfjs-node`: Not installed. Will be added as `optionalDependencies`. Falls back to pure JS automatically.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 4.0.18 |
| Config file | vitest.config.ts |
| Quick run command | `npx vitest run packages/bot-harness/tf-backend.test.ts` |
| Full suite command | `npm run test:unit` |

### Phase Requirements to Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SC-1 | Dynamic import tries tfjs-node first, falls back to tfjs on failure | unit | `npx vitest run packages/bot-harness/tf-backend.test.ts -x` | No -- Wave 0 |
| SC-2 | All training/inference code uses shared backend loader (no hardcoded imports) | lint/grep | `grep -r "from '@tensorflow/tfjs'" packages/bot-harness/ --include='*.ts' \| grep -v '.test.ts' \| grep -v 'tf-backend.ts' \| grep -v 'import type'` | N/A (grep check) |
| SC-3 | Native backend measurably faster than pure JS baseline | manual | Training benchmark comparison | N/A (manual on glibc system) |

### Sampling Rate
- **Per task commit:** `npx vitest run packages/bot-harness/tf-backend.test.ts -x`
- **Per wave merge:** `npm run test:unit`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `packages/bot-harness/tf-backend.test.ts` -- covers SC-1 (backend loader fallback behavior)
- [ ] Existing tests (`ppo-network.test.ts`, `ppo-trainer.test.ts`, `convergence.test.ts`, `opponent-pool.test.ts`) must continue passing after import migration

## Inventory of Files Requiring Changes

### Production Files (import `* as tf from '@tensorflow/tfjs'`)
| File | Import Type | Change Required |
|------|-------------|-----------------|
| `packages/bot-harness/training/ppo-trainer.ts` | value import | Replace with `getTf()` |
| `packages/bot-harness/training/ppo-network.ts` | value import | Replace with `getTf()` |
| `packages/bot-harness/training/training-coordinator.ts` | value import | Replace with `getTf()` |
| `packages/bot-harness/training/training-worker.ts` | value import | Replace with `getTf()` |
| `packages/bot-harness/training/tfjs-file-io.ts` | value import | Replace with `getTf()` |
| `packages/bot-harness/live-bot-strategy.ts` | value import | Replace with `getTf()` |
| `packages/bot-harness/model-loader.ts` | value import | Replace with `getTf()` |

### Production Files (type-only import)
| File | Import Type | Change Required |
|------|-------------|-----------------|
| `packages/bot-harness/training/opponent-pool.ts` | `import type * as tf` | Minimal -- already type-only, no runtime effect |

### Test Files (import `* as tf from '@tensorflow/tfjs'`)
| File | Change Required |
|------|-----------------|
| `packages/bot-harness/training/ppo-trainer.test.ts` | Replace with `getTf()` in `beforeAll` |
| `packages/bot-harness/training/ppo-network.test.ts` | Replace with `getTf()` in `beforeAll` |
| `packages/bot-harness/training/convergence.test.ts` | Replace with `getTf()` in `beforeAll` |
| `packages/bot-harness/training/opponent-pool.test.ts` | Replace with `getTf()` in `beforeAll` |

### Package Config
| File | Change Required |
|------|-----------------|
| `package.json` | Add `@tensorflow/tfjs-node` to `optionalDependencies`; consider pinning `@tensorflow/tfjs` to `4.22.0` |

### Export/Index Files
| File | Change Required |
|------|-----------------|
| `packages/bot-harness/index.ts` | Add `export * from './tf-backend.js'` |

## Sources

### Primary (HIGH confidence)
- [TensorFlow.js Node.js Guide](https://www.tensorflow.org/js/guide/nodejs) - backend selection, tfjs-node re-exports tfjs, API compatibility
- [npm @tensorflow/tfjs-node](https://www.npmjs.com/package/@tensorflow/tfjs-node) - version 4.22.0, last published ~1 year ago
- [npm @tensorflow/tfjs](https://www.npmjs.com/package/@tensorflow/tfjs) - version 4.22.0 stable

### Verified on Target System (HIGH confidence)
- Alpine Linux 3.24 / Node 24.13.0 / musl libc: `@tensorflow/tfjs-node` fails with `__memcpy_chk: symbol not found`
- Dynamic `import()` try/catch fallback pattern works correctly on this system
- `gcompat` (1.1.0-r4) is installed but insufficient for tfjs-node native binary

### Secondary (MEDIUM confidence)
- [GitHub Issue #8609](https://github.com/tensorflow/tfjs/issues/8609) - tfjs-node broken with Node 24, fix merged but unreleased
- [GitHub Issue #1425](https://github.com/tensorflow/tfjs/issues/1425) - tfjs-node on Alpine Linux musl libc (confirmed behavior)

### Tertiary (LOW confidence)
- Performance improvement claims (10-30x for native backend) are commonly cited but not independently verified for this specific workload (small PPO network, 15x15 grid)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - Packages verified on npm, API compatibility confirmed by official docs
- Architecture: HIGH - Dynamic import fallback pattern tested and verified on target system
- Pitfalls: HIGH - All pitfalls are based on direct observation or documented issues
- Performance claims: LOW - Native backend speed advantage not measured for this specific model/grid size

**Research date:** 2026-04-01
**Valid until:** 2026-05-01 (stable packages, no expected breaking changes)
