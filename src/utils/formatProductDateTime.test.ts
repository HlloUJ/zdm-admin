import { describe, expect, it } from 'vitest';
import { formatProductDateTime } from './formatProductDateTime';

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
