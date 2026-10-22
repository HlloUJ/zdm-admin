import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateOrderNumber } from './orderNumber';

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('sales order numbers', () => {
  it('uses uppercase XS, Unix seconds and three random digits', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-21T01:02:03.004Z'));
    vi.spyOn(crypto, 'getRandomValues').mockReturnValueOnce(new Uint32Array([7]));
    expect(generateOrderNumber()).toBe('XS1792544523007');
  });
  it('regenerates on every collision, within the same second', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-21T01:02:03.004Z'));
    const random = vi
      .spyOn(crypto, 'getRandomValues')
      .mockReturnValueOnce(new Uint32Array([7]))
      .mockReturnValueOnce(new Uint32Array([7]))
      .mockReturnValueOnce(new Uint32Array([23]));
    expect(generateOrderNumber(['XS1792544523007'])).toBe('XS1792544523023');
    expect(random).toHaveBeenCalledTimes(3);
  });
  it('ignores fractional milliseconds and preserves random leading zeros', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-21T09:02:03.999+08:00'));
    vi.spyOn(crypto, 'getRandomValues').mockReturnValueOnce(new Uint32Array([0]));
    expect(generateOrderNumber()).toBe('XS1792544523000');
  });
});
