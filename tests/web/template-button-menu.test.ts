import { describe, expect, it } from 'vitest';

import {
  TemplateButtonMenuElement,
  type TemplateButtonMenuTemplate,
} from '../../apps/web/src/template-button-menu.js';

const templates: readonly TemplateButtonMenuTemplate[] = [
  {
    id: 'block',
    name: 'Block',
    width: 2,
    height: 2,
    activationCost: 4,
  },
  {
    id: 'glider',
    name: 'Glider',
    width: 3,
    height: 3,
    activationCost: 8,
  },
];

describe('template button menu element', () => {
  it('highlights only the selected template while build mode is active', () => {
    const states = TemplateButtonMenuElement.deriveButtonStates({
      templates,
      selectedTemplateId: 'glider',
      buildModeActive: true,
      enabled: true,
    });

    expect(states).toEqual([
      {
        templateId: 'block',
        label: 'Block (2x2) | base 4',
        highlighted: false,
        disabled: false,
      },
      {
        templateId: 'glider',
        label: 'Glider (3x3) | base 8',
        highlighted: true,
        disabled: false,
      },
    ]);
  });

  it('removes highlight from every template when build mode is inactive', () => {
    const states = TemplateButtonMenuElement.deriveButtonStates({
      templates,
      selectedTemplateId: 'glider',
      buildModeActive: false,
      enabled: true,
    });

    expect(states.map((state) => state.highlighted)).toEqual([false, false]);
  });

  it('disables every template button when controls are read-only', () => {
    const states = TemplateButtonMenuElement.deriveButtonStates({
      templates,
      selectedTemplateId: 'block',
      buildModeActive: true,
      enabled: false,
    });

    expect(states.map((state) => state.disabled)).toEqual([true, true]);
  });
});
