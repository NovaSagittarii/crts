import { describe, expect, it } from 'vitest';

import type { CameraViewState } from '../../apps/web/src/camera-view-model.js';
import {
  type StructureCardLayerUpdateInput,
  StructureCardOverlayLayer,
  type StructureCardPlacementInput,
} from '../../apps/web/src/structure-card-overlay.js';
import {
  type FakeElementHandle,
  createFakeElement,
  createFakeRootElement,
} from './test-dom-support.js';

function createFakeCardElement(
  width: number,
  height: number,
): FakeElementHandle<HTMLElement> {
  return createFakeElement<HTMLElement>({
    initialClasses: ['structure-card', 'is-hidden'],
    width,
    height,
  });
}

function createLayerUpdateInput(
  overrides: Partial<StructureCardLayerUpdateInput> = {},
): StructureCardLayerUpdateInput {
  return {
    cards: [],
    camera: createCameraState(),
    cellSize: 16,
    viewportWidth: 640,
    viewportHeight: 360,
    ...overrides,
  };
}

function createCameraState(
  overrides: Partial<CameraViewState> = {},
): CameraViewState {
  return {
    zoom: 1,
    offsetX: 0,
    offsetY: 0,
    ...overrides,
  };
}

function createPlacementInput(
  overrides: Partial<StructureCardPlacementInput> = {},
): StructureCardPlacementInput {
  return {
    structureBounds: {
      x: 10,
      y: 12,
      width: 2,
      height: 2,
    },
    camera: createCameraState(),
    cellSize: 16,
    viewportWidth: 640,
    viewportHeight: 360,
    cardWidth: 180,
    cardHeight: 96,
    ...overrides,
  };
}

describe('structure card overlay layer', () => {
  it('anchors cards above structure bounds by default', () => {
    const placement = StructureCardOverlayLayer.computePlacement(
      createPlacementInput(),
    );

    expect(placement).toEqual({
      left: 86,
      top: 82,
      anchorX: 176,
      anchorY: 192,
    });
  });

  it('clamps cards inside the viewport edges', () => {
    const placement = StructureCardOverlayLayer.computePlacement(
      createPlacementInput({
        structureBounds: {
          x: 0,
          y: 0,
          width: 1,
          height: 1,
        },
        cardWidth: 220,
        cardHeight: 120,
        viewportWidth: 200,
        viewportHeight: 150,
      }),
    );

    expect(placement.left).toBe(8);
    expect(placement.top).toBe(8);
    expect(placement.anchorX).toBe(8);
    expect(placement.anchorY).toBe(0);
  });

  it('derives updates for multiple cards and hides cards not in the update set', () => {
    const renderPlan = StructureCardOverlayLayer.deriveRenderPlan({
      registeredIds: ['pinned', 'hover', 'future-card'],
      cards: [
        {
          id: 'pinned',
          structureBounds: { x: 15, y: 10, width: 2, height: 2 },
          variant: 'pinned',
          visible: true,
        },
        {
          id: 'hover',
          structureBounds: { x: 15, y: 10, width: 2, height: 2 },
          variant: 'hover',
          visible: true,
        },
      ],
      sizesById: {
        pinned: { width: 240, height: 140 },
        hover: { width: 180, height: 90 },
      },
      camera: createCameraState(),
      cellSize: 16,
      viewportWidth: 640,
      viewportHeight: 360,
    });

    expect(renderPlan).toEqual([
      {
        id: 'pinned',
        visible: true,
        variant: 'pinned',
        placement: {
          left: 136,
          top: 8,
          anchorX: 256,
          anchorY: 160,
        },
      },
      {
        id: 'hover',
        visible: true,
        variant: 'hover',
        placement: {
          left: 166,
          top: 56,
          anchorX: 256,
          anchorY: 160,
        },
      },
      {
        id: 'future-card',
        visible: false,
        variant: 'pinned',
        placement: null,
      },
    ]);

    const nextPlan = StructureCardOverlayLayer.deriveRenderPlan({
      registeredIds: ['pinned', 'hover'],
      cards: [
        {
          id: 'pinned',
          structureBounds: { x: 4, y: 4, width: 2, height: 2 },
          variant: 'pinned',
          visible: true,
        },
      ],
      sizesById: {
        pinned: { width: 240, height: 140 },
        hover: { width: 180, height: 90 },
      },
      camera: createCameraState(),
      cellSize: 16,
      viewportWidth: 640,
      viewportHeight: 360,
    });

    expect(nextPlan[0]?.visible).toBe(true);
    expect(nextPlan[1]).toEqual({
      id: 'hover',
      visible: false,
      variant: 'pinned',
      placement: null,
    });
  });

  it('toggles visible and hidden card classes when update visibility changes', () => {
    const root = createFakeRootElement();
    const layer = new StructureCardOverlayLayer(root);
    const pinnedCard = createFakeCardElement(240, 140);

    layer.registerCardElement('pinned', pinnedCard.element);

    layer.update(
      createLayerUpdateInput({
        cards: [
          {
            id: 'pinned',
            structureBounds: { x: 5, y: 5, width: 2, height: 2 },
            variant: 'pinned',
            visible: true,
          },
        ],
      }),
    );

    expect(pinnedCard.classNames.has('is-hidden')).toBe(false);
    expect(pinnedCard.classNames.has('is-visible')).toBe(true);
    expect(pinnedCard.attributes.get('aria-hidden')).toBe('false');
    expect(pinnedCard.style.zIndex).toBe('10');
    expect(pinnedCard.dataset.variant).toBe('pinned');

    layer.update(
      createLayerUpdateInput({
        cards: [],
      }),
    );

    expect(pinnedCard.classNames.has('is-hidden')).toBe(true);
    expect(pinnedCard.classNames.has('is-visible')).toBe(false);
    expect(pinnedCard.attributes.get('aria-hidden')).toBe('true');
  });
});
