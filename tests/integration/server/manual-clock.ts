import type { ServerOptions } from '../../../apps/server/src/server.js';

type SetIntervalHook = NonNullable<ServerOptions['setInterval']>;
type ClearIntervalHook = NonNullable<ServerOptions['clearInterval']>;
type SetTimeoutHook = NonNullable<ServerOptions['setTimeout']>;
type ClearTimeoutHook = NonNullable<ServerOptions['clearTimeout']>;

type TimerCallback = Parameters<SetTimeoutHook>[0];

type ScheduledHandle = {
  id: number;
};

interface ScheduledTask {
  readonly handle: ScheduledHandle;
  readonly callback: TimerCallback;
  readonly kind: 'interval' | 'timeout';
  readonly delayMs: number;
  runAtMs: number;
  active: boolean;
}

const DEFAULT_FLUSH_PASSES = 3;
const MAX_ADVANCE_CALLBACKS = 100_000;

function normalizeDelayMs(delayMs: number): number {
  if (!Number.isFinite(delayMs)) {
    return 0;
  }

  return Math.max(0, Math.floor(delayMs));
}

function getNextDueTask(
  scheduledTasks: Map<number, ScheduledTask>,
  targetMs: number,
): ScheduledTask | null {
  let nextTask: ScheduledTask | null = null;

  for (const task of scheduledTasks.values()) {
    if (!task.active || task.runAtMs > targetMs) {
      continue;
    }

    if (
      nextTask === null ||
      task.runAtMs < nextTask.runAtMs ||
      (task.runAtMs === nextTask.runAtMs && task.handle.id < nextTask.handle.id)
    ) {
      nextTask = task;
    }
  }

  return nextTask;
}

export async function flushAsyncWork(
  passes = DEFAULT_FLUSH_PASSES,
): Promise<void> {
  for (let index = 0; index < passes; index += 1) {
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });
  }
}

export interface ManualClock {
  readonly mode: 'manual';
  readonly nowMs: number;
  readonly pendingTaskCount: number;
  readonly now: () => number;
  readonly setInterval: SetIntervalHook;
  readonly clearInterval: ClearIntervalHook;
  readonly setTimeout: SetTimeoutHook;
  readonly clearTimeout: ClearTimeoutHook;
  advanceBy(ms: number): Promise<void>;
  flush(): Promise<void>;
}

export function createManualClock(initialTimeMs = 0): ManualClock {
  let currentTimeMs = initialTimeMs;
  let nextHandleId = 1;
  const scheduledTasks = new Map<number, ScheduledTask>();

  function scheduleTask(
    kind: ScheduledTask['kind'],
    callback: TimerCallback,
    delayMs: number,
  ): ScheduledHandle {
    const handle: ScheduledHandle = { id: nextHandleId };
    nextHandleId += 1;
    scheduledTasks.set(handle.id, {
      handle,
      callback,
      kind,
      delayMs: normalizeDelayMs(delayMs),
      runAtMs: currentTimeMs + normalizeDelayMs(delayMs),
      active: true,
    });
    return handle;
  }

  function clearTask(handle: ScheduledHandle): void {
    const task = scheduledTasks.get(handle.id);
    if (!task) {
      return;
    }

    task.active = false;
    scheduledTasks.delete(handle.id);
  }

  const setTimeoutHook: SetTimeoutHook = (callback, delayMs) =>
    scheduleTask(
      'timeout',
      callback,
      delayMs,
    ) as unknown as ReturnType<SetTimeoutHook>;

  const clearTimeoutHook: ClearTimeoutHook = (handle) => {
    clearTask(handle as unknown as ScheduledHandle);
  };

  const setIntervalHook: SetIntervalHook = (callback, delayMs) =>
    scheduleTask(
      'interval',
      callback,
      delayMs,
    ) as unknown as ReturnType<SetIntervalHook>;

  const clearIntervalHook: ClearIntervalHook = (handle) => {
    clearTask(handle as unknown as ScheduledHandle);
  };

  async function advanceBy(ms: number): Promise<void> {
    if (!Number.isFinite(ms) || ms < 0) {
      throw new Error(`Manual clock cannot advance by ${ms}`);
    }

    const targetMs = currentTimeMs + ms;
    let callbacksRun = 0;

    while (true) {
      const task = getNextDueTask(scheduledTasks, targetMs);
      if (task === null) {
        break;
      }

      callbacksRun += 1;
      if (callbacksRun > MAX_ADVANCE_CALLBACKS) {
        throw new Error('Manual clock exceeded callback safety limit');
      }

      currentTimeMs = task.runAtMs;
      if (task.kind === 'timeout') {
        scheduledTasks.delete(task.handle.id);
        task.active = false;
        task.callback();
        continue;
      }

      task.runAtMs += task.delayMs;
      task.callback();
      if (!task.active) {
        scheduledTasks.delete(task.handle.id);
      }
    }

    currentTimeMs = targetMs;
    await flushAsyncWork();
  }

  return {
    mode: 'manual',
    get nowMs() {
      return currentTimeMs;
    },
    get pendingTaskCount() {
      return scheduledTasks.size;
    },
    now: () => currentTimeMs,
    setInterval: setIntervalHook,
    clearInterval: clearIntervalHook,
    setTimeout: setTimeoutHook,
    clearTimeout: clearTimeoutHook,
    advanceBy,
    flush: () => flushAsyncWork(),
  };
}
