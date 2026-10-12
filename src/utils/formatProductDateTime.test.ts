import { describe, expect, it } from 'vitest';
import { formatProductDateTime } from './formatProductDateTime';
import { productLogTime } from '@/services/productOperationLog';

describe('formatProductDateTime', () => {
  it('renders UTC timestamps in Shanghai time for product pages', () => {
    expect(formatProductDateTime('2026-09-29 00:00:00')).toBe('2026/09/29 08:00');
    expect(formatProductDateTime('2026-09-29T01:02:03Z')).toBe('2026/09/29 09:02');
  });

  it('keeps the existing placeholder for missing or invalid values', () => {
    expect(formatProductDateTime()).toBe('-');
    expect(formatProductDateTime('invalid')).toBe('-');
  });
});

// One event is encoded as UTC by product logs and Beijing wall time by store logs.
it('shows the same supply edit instant on operations and store clients', () => {
  expect(formatProductDateTime('2026-10-12T06:10:11')).toBe('2026/10/12 14:10');
  expect(productLogTime('2026-10-12T14:10:11')).toBe('2026/10/12 14:10');
});
