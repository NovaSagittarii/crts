import { describe, expect, test, vi } from 'vitest';

import { createRenderScheduler } from '../../apps/web/src/render-scheduler.js';

describe('createRenderScheduler', () => {
  test('coalesces repeated render requests into one frame callback', () => {
    const pendingFrames = new Map<number, (timestamp: number) => void>();
    let nextFrameId = 1;
    const render = vi.fn();

    const scheduler = createRenderScheduler({
      render,
      requestAnimationFrame: (callback) => {
        const frameId = nextFrameId;
        nextFrameId += 1;
        pendingFrames.set(frameId, callback);
        return frameId;
      },
      cancelAnimationFrame: (frameId) => {
        pendingFrames.delete(frameId);
      },
    });

    scheduler.requestRender();
    scheduler.requestRender();
    scheduler.requestRender();

    expect(pendingFrames.size).toBe(1);
    expect(scheduler.hasPendingRender()).toBe(true);

    const pendingFrameEntry = [...pendingFrames.entries()][0];
    pendingFrames.delete(pendingFrameEntry[0]);
    pendingFrameEntry[1](16);

    expect(render).toHaveBeenCalledTimes(1);
    expect(scheduler.hasPendingRender()).toBe(false);

    scheduler.requestRender();
    expect(pendingFrames.size).toBe(1);
  });

  test('cancels pending frame and allows scheduling again', () => {
    const pendingFrames = new Map<number, (timestamp: number) => void>();
    const canceledFrames: number[] = [];
    let nextFrameId = 1;
    const render = vi.fn();

    const scheduler = createRenderScheduler({
      render,
      requestAnimationFrame: (callback) => {
        const frameId = nextFrameId;
        nextFrameId += 1;
        pendingFrames.set(frameId, callback);
        return frameId;
      },
      cancelAnimationFrame: (frameId) => {
        canceledFrames.push(frameId);
        pendingFrames.delete(frameId);
      },
    });

    scheduler.requestRender();
    expect(scheduler.hasPendingRender()).toBe(true);

    scheduler.cancelPendingRender();

    expect(canceledFrames).toEqual([1]);
    expect(pendingFrames.size).toBe(0);
    expect(render).toHaveBeenCalledTimes(0);
    expect(scheduler.hasPendingRender()).toBe(false);

    scheduler.requestRender();
    expect(pendingFrames.size).toBe(1);
  });
});
