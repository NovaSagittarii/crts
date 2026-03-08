interface ScheduledTimer {
  id: number;
  callback: () => void;
  delayMs: number;
  dueAtMs: number;
  order: number;
  repeating: boolean;
  active: boolean;
}

interface TimerHandle {
  id: number;
}

export interface ManualRuntime {
  now(): number;
  settle(): Promise<void>;
  advanceMs(ms: number): Promise<void>;
  runDueTimers(): Promise<void>;
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(timer: unknown): void;
  setInterval(callback: () => void, delayMs: number): unknown;
  clearInterval(timer: unknown): void;
}

function normalizeDelayMs(delayMs: number, minimumMs: number): number {
  if (!Number.isFinite(delayMs)) {
    return minimumMs;
  }

  return Math.max(minimumMs, Math.floor(delayMs));
}

function isTimerHandle(value: unknown): value is TimerHandle {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  return typeof (value as Partial<TimerHandle>).id === 'number';
}

async function settleMicrotasks(): Promise<void> {
  await Promise.resolve();
  await new Promise<void>((resolve) => {
    setImmediate(resolve);
  });
}

export function createManualRuntime(initialNowMs = Date.now()): ManualRuntime {
  let nowMs = initialNowMs;
  let nextId = 1;
  let nextOrder = 1;
  let advanceQueue = Promise.resolve();

  const scheduledTimers = new Map<number, ScheduledTimer>();

  function scheduleTimer(
    callback: () => void,
    delayMs: number,
    repeating: boolean,
  ): TimerHandle {
    const normalizedDelayMs = normalizeDelayMs(delayMs, repeating ? 1 : 0);
    const handle: TimerHandle = { id: nextId };
    nextId += 1;

    scheduledTimers.set(handle.id, {
      id: handle.id,
      callback,
      delayMs: normalizedDelayMs,
      dueAtMs: nowMs + normalizedDelayMs,
      order: nextOrder,
      repeating,
      active: true,
    });
    nextOrder += 1;

    return handle;
  }

  function clearTimer(timer: unknown): void {
    if (!isTimerHandle(timer)) {
      return;
    }

    const scheduled = scheduledTimers.get(timer.id);
    if (!scheduled) {
      return;
    }

    scheduled.active = false;
    scheduledTimers.delete(timer.id);
  }

  function getNextDueTimer(targetTimeMs: number): ScheduledTimer | null {
    let nextTimer: ScheduledTimer | null = null;

    for (const timer of scheduledTimers.values()) {
      if (!timer.active || timer.dueAtMs > targetTimeMs) {
        continue;
      }

      if (
        nextTimer === null ||
        timer.dueAtMs < nextTimer.dueAtMs ||
        (timer.dueAtMs === nextTimer.dueAtMs && timer.order < nextTimer.order)
      ) {
        nextTimer = timer;
      }
    }

    return nextTimer;
  }

  async function runTimer(timer: ScheduledTimer): Promise<void> {
    const activeTimer = scheduledTimers.get(timer.id);
    if (!activeTimer || !activeTimer.active) {
      return;
    }

    scheduledTimers.delete(timer.id);
    activeTimer.active = false;
    activeTimer.callback();
    await settleMicrotasks();

    if (!activeTimer.repeating || scheduledTimers.has(activeTimer.id)) {
      return;
    }

    activeTimer.active = true;
    activeTimer.dueAtMs += activeTimer.delayMs;
    activeTimer.order = nextOrder;
    nextOrder += 1;
    scheduledTimers.set(activeTimer.id, activeTimer);
  }

  async function enqueueAdvance(operation: () => Promise<void>): Promise<void> {
    const pending = advanceQueue.then(operation);
    advanceQueue = pending.catch(() => undefined);
    await pending;
  }

  async function advanceTo(targetTimeMs: number): Promise<void> {
    while (true) {
      const nextTimer = getNextDueTimer(targetTimeMs);
      if (!nextTimer) {
        break;
      }

      nowMs = nextTimer.dueAtMs;
      await runTimer(nextTimer);
    }

    nowMs = targetTimeMs;
    await settleMicrotasks();
  }

  return {
    now(): number {
      return nowMs;
    },
    async settle(): Promise<void> {
      await settleMicrotasks();
    },
    async advanceMs(ms: number): Promise<void> {
      const normalizedMs = normalizeDelayMs(ms, 0);
      await enqueueAdvance(async () => {
        await advanceTo(nowMs + normalizedMs);
      });
    },
    async runDueTimers(): Promise<void> {
      await enqueueAdvance(async () => {
        await advanceTo(nowMs);
      });
    },
    setTimeout(callback: () => void, delayMs: number): unknown {
      return scheduleTimer(callback, delayMs, false);
    },
    clearTimeout(timer: unknown): void {
      clearTimer(timer);
    },
    setInterval(callback: () => void, delayMs: number): unknown {
      return scheduleTimer(callback, delayMs, true);
    },
    clearInterval(timer: unknown): void {
      clearTimer(timer);
    },
  };
}
