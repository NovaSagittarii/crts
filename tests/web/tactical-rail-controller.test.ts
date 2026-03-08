import { describe, expect, it } from 'vitest';

import { TacticalRailController } from '../../apps/web/src/tactical-rail-controller.js';

interface FakeElementHandle<T extends HTMLElement> {
  element: T;
  classNames: Set<string>;
  attributes: Map<string, string>;
  dataset: DOMStringMap;
}

function createFakeElement<T extends HTMLElement>(): FakeElementHandle<T> {
  const classNames = new Set<string>();
  const attributes = new Map<string, string>();
  const dataset = {} as DOMStringMap;

  const element = {
    classList: {
      add: (...tokens: string[]) => {
        for (const token of tokens) {
          classNames.add(token);
        }
      },
      remove: (...tokens: string[]) => {
        for (const token of tokens) {
          classNames.delete(token);
        }
      },
      contains: (token: string) => classNames.has(token),
      toggle: (token: string, force?: boolean) => {
        if (force === undefined) {
          if (classNames.has(token)) {
            classNames.delete(token);
            return false;
          }
          classNames.add(token);
          return true;
        }

        if (force) {
          classNames.add(token);
          return true;
        }

        classNames.delete(token);
        return false;
      },
    },
    setAttribute: (name: string, value: string) => {
      attributes.set(name, value);
    },
    hidden: false,
    disabled: false,
    textContent: '',
    dataset,
  } as unknown as T;

  return {
    element,
    classNames,
    attributes,
    dataset,
  };
}

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
