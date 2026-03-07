import { describe, expect, it } from 'vitest';

import {
  BuildModeController,
  type BuildModeTemplate,
} from '../../apps/web/src/build-mode-controller.js';

const blockTemplate: BuildModeTemplate = {
  id: 'block',
  width: 2,
  height: 2,
};

describe('build mode controller', () => {
  it('does not project candidates while inactive', () => {
    const controller = new BuildModeController();
    const update = controller.updateCandidateForCell(blockTemplate, {
      x: 8,
      y: 6,
    });

    expect(update).toEqual({ changed: false, placement: null });
    expect(controller.active).toBe(false);
    expect(controller.candidatePlacement).toBeNull();
  });

  it('projects centered candidate coordinates while active', () => {
    const controller = new BuildModeController();
    controller.activate();

    const update = controller.updateCandidateForCell(blockTemplate, {
      x: 8,
      y: 6,
    });

    expect(update).toEqual({
      changed: true,
      placement: {
        templateId: 'block',
        x: 7,
        y: 5,
      },
    });
    expect(controller.candidatePlacement).toEqual(update.placement);
  });

  it('does not emit a candidate update when pointer cell is unchanged', () => {
    const controller = new BuildModeController();
    controller.activate();
    controller.updateCandidateForCell(blockTemplate, { x: 8, y: 6 });

    const update = controller.updateCandidateForCell(blockTemplate, {
      x: 8,
      y: 6,
    });

    expect(update).toEqual({
      changed: false,
      placement: {
        templateId: 'block',
        x: 7,
        y: 5,
      },
    });
  });

  it('keeps build mode active after queue-projection updates', () => {
    const controller = new BuildModeController();
    controller.activate();
    controller.updateCandidateForCell(blockTemplate, { x: 2, y: 2 });

    expect(controller.active).toBe(true);
  });

  it('clears active candidate state when build mode exits', () => {
    const controller = new BuildModeController();
    controller.activate();
    controller.updateCandidateForCell(blockTemplate, { x: 8, y: 6 });

    controller.deactivate();

    expect(controller.active).toBe(false);
    expect(controller.candidatePlacement).toBeNull();
  });
});
