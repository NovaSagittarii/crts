import { describe, expect, it } from 'vitest';

import {
  createAuthoritativePreviewRefreshState,
  getStateRequestSectionsForGameplayEvent,
  recordAuthoritativePreviewRefresh,
  shouldApplyRoomScopedPayload,
  shouldRefreshAuthoritativePreview,
} from '../../apps/web/src/client-sync-helpers.js';

describe('client sync helpers', () => {
  it('accepts matching and global room payloads but rejects stale room payloads', () => {
    expect(shouldApplyRoomScopedPayload('room-a', 'room-a')).toBe(true);
    expect(shouldApplyRoomScopedPayload('room-a', null)).toBe(true);
    expect(shouldApplyRoomScopedPayload('room-a', 'room-b')).toBe(false);
  });

  it('refreshes authoritative preview per section for the same tick', () => {
    const state = createAuthoritativePreviewRefreshState();

    expect(
      shouldRefreshAuthoritativePreview({
        section: 'grid',
        tick: 12,
        hasSelectedPlacement: true,
        canMutateGameplay: true,
        previewPending: false,
        state,
      }),
    ).toBe(true);

    const refreshedGrid = recordAuthoritativePreviewRefresh(state, 'grid', 12);

    expect(
      shouldRefreshAuthoritativePreview({
        section: 'grid',
        tick: 12,
        hasSelectedPlacement: true,
        canMutateGameplay: true,
        previewPending: false,
        state: refreshedGrid,
      }),
    ).toBe(false);

    expect(
      shouldRefreshAuthoritativePreview({
        section: 'structures',
        tick: 12,
        hasSelectedPlacement: true,
        canMutateGameplay: true,
        previewPending: false,
        state: refreshedGrid,
      }),
    ).toBe(true);
  });

  it('skips preview refresh when placement is missing or preview is pending', () => {
    const state = createAuthoritativePreviewRefreshState();

    expect(
      shouldRefreshAuthoritativePreview({
        section: 'full',
        tick: 4,
        hasSelectedPlacement: false,
        canMutateGameplay: true,
        previewPending: false,
        state,
      }),
    ).toBe(false);

    expect(
      shouldRefreshAuthoritativePreview({
        section: 'full',
        tick: 4,
        hasSelectedPlacement: true,
        canMutateGameplay: true,
        previewPending: true,
        state,
      }),
    ).toBe(false);
  });

  it('does not request authoritative state sections for queued or scheduled gameplay events', () => {
    expect(
      getStateRequestSectionsForGameplayEvent('build:queued'),
    ).toBeUndefined();
    expect(
      getStateRequestSectionsForGameplayEvent('build:outcome'),
    ).toBeUndefined();
    expect(
      getStateRequestSectionsForGameplayEvent('destroy:queued'),
    ).toBeUndefined();
    expect(
      getStateRequestSectionsForGameplayEvent('destroy:outcome'),
    ).toBeUndefined();
  });
});
