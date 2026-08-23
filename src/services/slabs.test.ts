import { describe, expect, it } from 'vitest';

import { resolveSlabPublishTargetStatus } from './slabs';

describe('resolveSlabPublishTargetStatus', () => {
  it('keeps products published from the warehouse tab in the warehouse', () => {
    expect(resolveSlabPublishTargetStatus('warehouse')).toBe('warehouse');
  });

  it('keeps products published from the selling tab in selling', () => {
    expect(resolveSlabPublishTargetStatus('selling')).toBe('selling');
  });

  it('falls back to the warehouse when publishing is unavailable for the current tab', () => {
    expect(resolveSlabPublishTargetStatus('offShelf')).toBe('warehouse');
  });
});
