import { describe, expect, it } from 'vitest';
import { formatStoreRuleDateTime } from './formatStoreRuleDateTime';

describe('formatStoreRuleDateTime', () => {
  it('preserves Shanghai database wall time without adding eight hours', () => {
    expect(formatStoreRuleDateTime('2026-10-10T10:56:55')).toBe('2026/10/10 10:56');
    expect(formatStoreRuleDateTime('2026-10-10 23:56:55')).toBe('2026/10/10 23:56');
    expect(formatStoreRuleDateTime('2026-10-10T00:05:00.123')).toBe('2026/10/10 00:05');
  });

  it('keeps placeholders for missing or incompatible timestamps', () => {
    expect(formatStoreRuleDateTime()).toBe('-');
    expect(formatStoreRuleDateTime('invalid')).toBe('-');
    expect(formatStoreRuleDateTime('2026-10-10T10:56:55Z')).toBe('-');
  });
});
