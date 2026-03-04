export type ScheduleFrame = (callback: (timestamp: number) => void) => number;
export type CancelFrame = (frameId: number) => void;

export interface RenderScheduler {
  requestRender: () => void;
  cancelPendingRender: () => void;
  hasPendingRender: () => boolean;
}

export interface CreateRenderSchedulerOptions {
  render: () => void;
  requestAnimationFrame: ScheduleFrame;
  cancelAnimationFrame: CancelFrame;
}

export function createRenderScheduler(
  options: CreateRenderSchedulerOptions,
): RenderScheduler {
  let pendingFrameId: number | null = null;

  const runRenderFrame = (): void => {
    pendingFrameId = null;
    options.render();
  };

  return {
    requestRender: (): void => {
      if (pendingFrameId !== null) {
        return;
      }

      pendingFrameId = options.requestAnimationFrame(runRenderFrame);
    },
    cancelPendingRender: (): void => {
      if (pendingFrameId === null) {
        return;
      }

      options.cancelAnimationFrame(pendingFrameId);
      pendingFrameId = null;
    },
    hasPendingRender: (): boolean => pendingFrameId !== null,
  };
}
