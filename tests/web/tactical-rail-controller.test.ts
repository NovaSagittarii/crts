import { describe, expect, it } from 'vitest';

import { TacticalRailController } from '../../apps/web/src/tactical-rail-controller.js';
import { createFakeElement } from './test-dom-support.js';

function createFixture() {
  const rail = createFakeElement<HTMLElement>();
  const compactButton = createFakeElement<HTMLButtonElement>();
  const minimizeButton = createFakeElement<HTMLButtonElement>();

  return {
    rail,
    compactButton,
    minimizeButton,
    controller: new TacticalRailController({
      railEl: rail.element,
      compactButtonEl: compactButton.element,
      minimizeButtonEl: minimizeButton.element,
    }),
  };
}

describe('tactical rail controller', () => {
  it('hides desktop rail controls while lobby screen is active', () => {
    const { rail, compactButton, minimizeButton, controller } = createFixture();

    controller.syncScreen('lobby');

    expect(compactButton.element.hidden).toBe(true);
    expect(minimizeButton.element.hidden).toBe(true);
    expect(rail.dataset.overlayMode).toBe('expanded');
  });

  it('shows controls in ingame and tracks selected tactical section', () => {
    const { rail, compactButton, minimizeButton, controller } = createFixture();

    controller.syncScreen('ingame');
    controller.setActiveSection('team');

    expect(compactButton.element.hidden).toBe(false);
    expect(minimizeButton.element.hidden).toBe(false);
    expect(rail.dataset.activeSection).toBe('team');
  });

  it('toggles compact mode with matching class and aria state', () => {
    const { rail, compactButton, controller } = createFixture();

    controller.syncScreen('ingame');
    controller.toggleCompact();

    expect(rail.classNames.has('tactical-rail--compact')).toBe(true);
    expect(compactButton.attributes.get('aria-pressed')).toBe('true');
    expect(compactButton.element.textContent).toBe('Expanded view');

    controller.toggleCompact();

    expect(rail.classNames.has('tactical-rail--compact')).toBe(false);
    expect(compactButton.attributes.get('aria-pressed')).toBe('false');
  });

  it('toggles minimized mode and disables compact toggle while minimized', () => {
    const { rail, compactButton, minimizeButton, controller } = createFixture();

    controller.syncScreen('ingame');
    controller.toggleMinimized();

    expect(rail.classNames.has('tactical-rail--minimized')).toBe(true);
    expect(compactButton.element.disabled).toBe(true);
    expect(minimizeButton.attributes.get('aria-pressed')).toBe('true');
    expect(minimizeButton.element.textContent).toBe('Show overlay');

    controller.toggleCompact();
    expect(rail.classNames.has('tactical-rail--compact')).toBe(false);

    controller.toggleMinimized();

    expect(rail.classNames.has('tactical-rail--minimized')).toBe(false);
    expect(compactButton.element.disabled).toBe(false);
  });

  it('resets rail mode to expanded when lobby screen resumes', () => {
    const { rail, controller } = createFixture();

    controller.syncScreen('ingame');
    controller.toggleCompact();
    controller.toggleMinimized();
    controller.syncScreen('lobby');

    expect(rail.dataset.overlayMode).toBe('expanded');
    expect(rail.classNames.has('tactical-rail--compact')).toBe(false);
    expect(rail.classNames.has('tactical-rail--minimized')).toBe(false);
  });
});
