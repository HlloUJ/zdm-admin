import { describe, it, expect } from 'vitest';
import { stripLocalPaymentConfiguration } from './paymentNames';
describe('retired local payment configuration', () => {
  it('removes local-only configuration without uploading it or rewriting historical payments', () => {
    const state = {
      settings: [{ group: 'nature', name: '旧定金' }],
      paymentNames: [{ id: 'local', name: '本地定金' }],
      orders: [{ payments: [{ nature: '历史定金', method: '银行转账', amount: 100 }] }],
    };
    const orders = structuredClone(state.orders);
    stripLocalPaymentConfiguration(state);
    expect(state).not.toHaveProperty('settings');
    expect(state).not.toHaveProperty('paymentNames');
    expect(state.orders).toEqual(orders);
    stripLocalPaymentConfiguration(state);
    expect(state.orders).toEqual(orders);
  });
});
