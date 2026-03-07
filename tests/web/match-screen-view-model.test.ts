import { describe, expect, test } from 'vitest';

import {
  RECONNECT_SYNCED_COPY,
  RECONNECT_SYNCING_COPY,
  applyAuthoritativeStatus,
  clearReconnectNotice,
  createMatchScreenViewState,
  getReconnectNoticeCopy,
  hasVisibleReconnectNotice,
  isReconnectSyncing,
  markReconnectPending,
  resolveScreenForStatus,
} from '../../apps/web/src/match-screen-view-model.js';

describe('match-screen-view-model helpers', () => {
  test('maps authoritative lifecycle statuses to dedicated screens', () => {
    expect(resolveScreenForStatus('lobby')).toBe('lobby');
    expect(resolveScreenForStatus('countdown')).toBe('lobby');
    expect(resolveScreenForStatus('active')).toBe('ingame');
    expect(resolveScreenForStatus('finished')).toBe('ingame');
  });

  test('deduplicates transition banners when status does not change', () => {
    const state = createMatchScreenViewState('countdown');

    const repeated = applyAuthoritativeStatus(state, 'countdown');
    expect(repeated.statusChanged).toBe(false);
    expect(repeated.transitionBannerCopy).toBeNull();

    const transitioned = applyAuthoritativeStatus(state, 'active');
    expect(transitioned.statusChanged).toBe(true);
    expect(transitioned.screenChanged).toBe(true);
    expect(transitioned.transitionBannerCopy).toContain('Active');
  });

  test('models reconnect syncing then authoritative confirmation copy', () => {
    const reconnecting = markReconnectPending(
      createMatchScreenViewState('active'),
    );
    expect(getReconnectNoticeCopy(reconnecting)).toBe(RECONNECT_SYNCING_COPY);

    const resolved = applyAuthoritativeStatus(reconnecting, 'finished');
    expect(resolved.reconnectCopy).toBe(RECONNECT_SYNCED_COPY);
    expect(resolved.state.pendingReconnect).toBe(false);
    expect(getReconnectNoticeCopy(resolved.state)).toBe(RECONNECT_SYNCED_COPY);

    const cleared = clearReconnectNotice(resolved.state);
    expect(getReconnectNoticeCopy(cleared)).toBeNull();
  });

  test('exposes reconnect mode helpers for UI sync hints', () => {
    const base = createMatchScreenViewState('active');
    expect(hasVisibleReconnectNotice(base)).toBe(false);
    expect(isReconnectSyncing(base)).toBe(false);

    const reconnecting = markReconnectPending(base);
    expect(hasVisibleReconnectNotice(reconnecting)).toBe(true);
    expect(isReconnectSyncing(reconnecting)).toBe(true);

    const resolved = applyAuthoritativeStatus(reconnecting, 'active').state;
    expect(hasVisibleReconnectNotice(resolved)).toBe(true);
    expect(isReconnectSyncing(resolved)).toBe(false);

    const cleared = clearReconnectNotice(resolved);
    expect(hasVisibleReconnectNotice(cleared)).toBe(false);
    expect(isReconnectSyncing(cleared)).toBe(false);
  });
});
