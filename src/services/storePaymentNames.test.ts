import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  listStorePaymentNames,
  listStorePaymentNameOptions,
  createStorePaymentName,
  updateStorePaymentName,
  setStorePaymentNameStatus,
  deleteStorePaymentName,
} from './storePaymentNames';
afterEach(() => vi.unstubAllGlobals());
describe('store payment name API', () => {
  it('uses scoped authenticated APIs and keeps versions and target status in mutations', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue({ ok: true, status: 200, json: async () => ({ code: 0, data: { items: [], total: 0 } }) });
    vi.stubGlobal('fetch', fetch);
    await listStorePaymentNames(2, 10);
    await listStorePaymentNameOptions();
    await createStorePaymentName('定金');
    await updateStorePaymentName('17', '订金', 3);
    await setStorePaymentNameStatus('17', false, 4);
    await deleteStorePaymentName('17', 5);
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      '/api/store/payment-names?page=2&pageSize=10',
      '/api/store/payment-names/options',
      '/api/store/payment-names',
      '/api/store/payment-names/17',
      '/api/store/payment-names/17/status',
      '/api/store/payment-names/17?version=5',
    ]);
    expect(JSON.parse(fetch.mock.calls[3][1].body)).toEqual({ name: '订金', version: 3 });
    expect(JSON.parse(fetch.mock.calls[4][1].body)).toEqual({ enabled: false, version: 4 });
    expect(fetch.mock.calls[5][1].method).toBe('DELETE');
    expect(fetch.mock.calls.every(([, init]) => !String(init.body || '').includes('storeId'))).toBe(true);
  });
  it('propagates API errors rather than returning browser fallback configuration', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: async () => ({ code: 400, message: '配置已被其他人修改，请刷新后重试' }),
      }),
    );
    await expect(updateStorePaymentName('1', '定金', 1)).rejects.toThrow('配置已被其他人修改');
  });
});
