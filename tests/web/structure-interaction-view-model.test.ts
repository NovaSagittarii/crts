import { describe, expect, test } from 'vitest';

import {
  canShowStructureActions,
  createStructureInteractionState,
  reduceStructureInteraction,
  selectActiveStructureKey,
  selectStructureInteractionMode,
} from '../../apps/web/src/structure-interaction-view-model.js';

describe('structure-interaction-view-model helpers', () => {
  test('keeps hover active through leave grace and expires after timeout', () => {
    let state = createStructureInteractionState();
    state = reduceStructureInteraction(state, {
      type: 'hover-enter',
      structureKey: 'alpha',
    });
    state = reduceStructureInteraction(state, {
      type: 'hover-leave',
      atMs: 1_000,
      graceMs: 300,
    });

    expect(selectActiveStructureKey(state, 1_250)).toBe('alpha');

    state = reduceStructureInteraction(state, {
      type: 'tick',
      atMs: 1_300,
    });
    expect(selectActiveStructureKey(state, 1_300)).toBeNull();
    expect(selectStructureInteractionMode(state, 1_300)).toBe('idle');
  });

  test('cancels leave grace when pointer re-enters the same structure', () => {
    let state = createStructureInteractionState();
    state = reduceStructureInteraction(state, {
      type: 'hover-enter',
      structureKey: 'alpha',
    });
    state = reduceStructureInteraction(state, {
      type: 'hover-leave',
      atMs: 2_000,
      graceMs: 300,
    });

    state = reduceStructureInteraction(state, {
      type: 'hover-enter',
      structureKey: 'alpha',
    });

    state = reduceStructureInteraction(state, {
      type: 'tick',
      atMs: 2_500,
    });
    expect(selectActiveStructureKey(state, 2_500)).toBe('alpha');
    expect(selectStructureInteractionMode(state, 2_500)).toBe('hover');
  });

  test('keeps pinned structure active and action-enabled until explicitly unpinned', () => {
    let state = createStructureInteractionState();
    state = reduceStructureInteraction(state, {
      type: 'hover-enter',
      structureKey: 'base-core',
    });
    state = reduceStructureInteraction(state, { type: 'pin-active' });
    state = reduceStructureInteraction(state, {
      type: 'hover-leave',
      atMs: 10,
      graceMs: 300,
    });
    state = reduceStructureInteraction(state, {
      type: 'tick',
      atMs: 5_000,
    });

    expect(selectActiveStructureKey(state, 5_000)).toBe('base-core');
    expect(selectStructureInteractionMode(state, 5_000)).toBe('pinned');
    expect(canShowStructureActions(state, 5_000)).toBe(true);
  });

  test('allows hover preview to expire while pinned state stays action-ready', () => {
    let state = createStructureInteractionState();
    state = reduceStructureInteraction(state, {
      type: 'pin',
      structureKey: 'base-core',
    });

    state = reduceStructureInteraction(state, {
      type: 'hover-leave',
      atMs: 10,
      graceMs: 300,
    });
    state = reduceStructureInteraction(state, {
      type: 'tick',
      atMs: 400,
    });

    expect(selectActiveStructureKey(state, 400)).toBe('base-core');
    expect(selectStructureInteractionMode(state, 400)).toBe('pinned');
    expect(canShowStructureActions(state, 400)).toBe(true);

    state = reduceStructureInteraction(state, { type: 'unpin' });

    expect(selectActiveStructureKey(state, 401)).toBeNull();
    expect(selectStructureInteractionMode(state, 401)).toBe('idle');
  });

  test('returns to hover-only mode after unpin and disables actions', () => {
    let state = createStructureInteractionState();
    state = reduceStructureInteraction(state, {
      type: 'pin',
      structureKey: 'generator-1',
    });

    state = reduceStructureInteraction(state, { type: 'unpin' });

    expect(selectActiveStructureKey(state, 20)).toBe('generator-1');
    expect(selectStructureInteractionMode(state, 20)).toBe('hover');
    expect(canShowStructureActions(state, 20)).toBe(false);

    state = reduceStructureInteraction(state, {
      type: 'hover-leave',
      atMs: 20,
      graceMs: 300,
    });
    state = reduceStructureInteraction(state, {
      type: 'tick',
      atMs: 321,
    });
    expect(selectActiveStructureKey(state, 321)).toBeNull();
  });

  test('reconciles pinned and hovered keys against authoritative structures', () => {
    let state = createStructureInteractionState();
    state = reduceStructureInteraction(state, {
      type: 'pin',
      structureKey: 'core-1',
    });

    state = reduceStructureInteraction(state, {
      type: 'reconcile',
      availableStructureKeys: ['beacon-2'],
    });

    expect(selectActiveStructureKey(state, 100)).toBeNull();
    expect(canShowStructureActions(state, 100)).toBe(false);

    state = reduceStructureInteraction(state, {
      type: 'hover-enter',
      structureKey: 'beacon-2',
    });
    state = reduceStructureInteraction(state, {
      type: 'reconcile',
      availableStructureKeys: [],
    });

    expect(selectActiveStructureKey(state, 100)).toBeNull();
    expect(selectStructureInteractionMode(state, 100)).toBe('idle');
  });

  test('keeps single active key while another structure is hovered during pin', () => {
    let state = createStructureInteractionState();
    state = reduceStructureInteraction(state, {
      type: 'pin',
      structureKey: 'alpha',
    });

    state = reduceStructureInteraction(state, {
      type: 'hover-enter',
      structureKey: 'beta',
    });

    expect(selectActiveStructureKey(state, 10)).toBe('alpha');
    expect(canShowStructureActions(state, 10)).toBe(true);
  });
});
