import { describe, expect, it } from 'vitest';

import {
  type StructureGridOverlayInput,
  StructureGridOverlayModel,
} from '../../apps/web/src/structure-grid-overlay-view-model.js';

function createOverlayInput(
  overrides: Partial<StructureGridOverlayInput> = {},
): StructureGridOverlayInput {
  return {
    structures: [
      {
        key: 'alpha',
        x: 2,
        y: 2,
        width: 3,
        height: 2,
        hp: 90,
        templateName: 'Power Relay',
      },
      {
        key: 'bravo',
        x: 20,
        y: 5,
        width: 2,
        height: 2,
        hp: 30,
        templateName: 'Shield Node',
      },
    ],
    hoveredStructureKey: null,
    pinnedStructureKey: null,
    maxHpByTemplateId: {},
    visibleBounds: {
      minX: 0,
      maxX: 10,
      minY: 0,
      maxY: 10,
    },
    ...overrides,
  };
}

describe('structure grid overlay view model', () => {
  it('returns only structures that intersect visible bounds', () => {
    const overlays =
      StructureGridOverlayModel.deriveOverlayItems(createOverlayInput());

    expect(overlays).toHaveLength(1);
    expect(overlays[0]?.key).toBe('alpha');
  });

  it('enables labels only for hovered structures', () => {
    const overlays = StructureGridOverlayModel.deriveOverlayItems(
      createOverlayInput({
        hoveredStructureKey: 'bravo',
        visibleBounds: {
          minX: 0,
          maxX: 30,
          minY: 0,
          maxY: 20,
        },
      }),
    );

    expect(
      overlays.map((overlay) => ({
        key: overlay.key,
        showLabel: overlay.showLabel,
        interactionState: overlay.interactionState,
      })),
    ).toEqual([
      { key: 'alpha', showLabel: false, interactionState: 'idle' },
      { key: 'bravo', showLabel: true, interactionState: 'hovered' },
    ]);
  });

  it('marks pinned structures separately from hovered ones', () => {
    const overlays = StructureGridOverlayModel.deriveOverlayItems(
      createOverlayInput({
        hoveredStructureKey: 'bravo',
        pinnedStructureKey: 'alpha',
        visibleBounds: {
          minX: 0,
          maxX: 30,
          minY: 0,
          maxY: 20,
        },
      }),
    );

    expect(
      overlays.map((overlay) => ({
        key: overlay.key,
        interactionState: overlay.interactionState,
      })),
    ).toEqual([
      { key: 'alpha', interactionState: 'pinned' },
      { key: 'bravo', interactionState: 'hovered' },
    ]);
  });

  it('computes a clamped integrity ratio from template max hp', () => {
    const overlays = StructureGridOverlayModel.deriveOverlayItems(
      createOverlayInput({
        structures: [
          {
            key: 'alpha',
            x: 2,
            y: 2,
            width: 3,
            height: 2,
            hp: 120,
            templateId: 'relay',
            templateName: 'Power Relay',
          },
        ],
        maxHpByTemplateId: {
          relay: 80,
        },
      }),
    );

    expect(overlays[0]?.integrityRatio).toBe(1);
  });

  it('scales integrity ratio proportionally to template starting hp', () => {
    const overlays = StructureGridOverlayModel.deriveOverlayItems(
      createOverlayInput({
        structures: [
          {
            key: 'core',
            x: 4,
            y: 4,
            width: 4,
            height: 4,
            hp: 250,
            templateId: 'core-template',
            templateName: 'Core',
          },
        ],
        maxHpByTemplateId: {
          'core-template': 500,
        },
      }),
    );

    expect(overlays[0]?.integrityRatio).toBe(0.5);
  });

  it('prefers template starting hp over structure starting hp', () => {
    const overlays = StructureGridOverlayModel.deriveOverlayItems(
      createOverlayInput({
        structures: [
          {
            key: 'node',
            x: 5,
            y: 5,
            width: 2,
            height: 2,
            hp: 100,
            startingHp: 200,
            templateId: 'node-template',
            templateName: 'Node',
          },
        ],
        maxHpByTemplateId: {
          'node-template': 500,
        },
      }),
    );

    expect(overlays[0]?.integrityRatio).toBe(0.2);
  });

  it('falls back to structure starting hp when template max hp is unavailable', () => {
    const overlays = StructureGridOverlayModel.deriveOverlayItems(
      createOverlayInput({
        structures: [
          {
            key: 'node',
            x: 5,
            y: 5,
            width: 2,
            height: 2,
            hp: 100,
            startingHp: 200,
            templateId: 'node-template',
            templateName: 'Node',
          },
        ],
      }),
    );

    expect(overlays[0]?.integrityRatio).toBe(0.5);
  });

  it('returns null integrity ratio when max hp is unavailable', () => {
    const overlays = StructureGridOverlayModel.deriveOverlayItems(
      createOverlayInput({
        structures: [
          {
            key: 'alpha',
            x: 2,
            y: 2,
            width: 3,
            height: 2,
            hp: 12,
            templateId: 'relay',
            templateName: 'Power Relay',
          },
        ],
      }),
    );

    expect(overlays[0]?.integrityRatio).toBeNull();
  });

  it('derives render integrity ratio without hp/100 fallback', () => {
    expect(
      StructureGridOverlayModel.deriveRenderIntegrityRatio({
        integrityRatio: null,
        hp: 87,
      }),
    ).toBe(1);

    expect(
      StructureGridOverlayModel.deriveRenderIntegrityRatio({
        integrityRatio: null,
        hp: 0,
      }),
    ).toBe(0);
  });
});
