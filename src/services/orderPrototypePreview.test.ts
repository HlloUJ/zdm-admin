import { afterEach, describe, expect, it, vi } from 'vitest';
import { hasMenuPermission, hasPermission, hasPermissionPrefix } from './adminPermissions';
import { canPreviewStoreOrders } from './orderPrototypePreview';
import type { LoginUser } from './auth';
const user: LoginUser = {
  id: 7,
  name: '预览导购',
  phone: '13800000001',
  tenantId: 1,
  storeId: 2,
  storeType: 'cityPartner',
  roles: [],
  permissions: [],
};
function location(url = 'http://127.0.0.1:5175/') {
  vi.stubGlobal('window', { location: new URL(url) });
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
describe('local order prototype preview permission boundary', () => {
  it('opens only order menu, tabs and simulated actions for an ungranted store identity on 5175', () => {
    location();
    expect(hasMenuPermission(user, 'store.order-management.sales')).toBe(true);
    expect(hasPermissionPrefix(user, 'store.order-management.settings')).toBe(true);
    expect(hasPermission(user, 'store.order-management.sales.pending.view')).toBe(true);
    expect(hasPermission(user, 'store.order-management.sales.pending.create')).toBe(true);
    expect(hasPermission(user, 'store.order-management.fulfillment.ship')).toBe(true);
    expect(hasPermission(user, 'store.finished-stock-management.selling.view')).toBe(false);
    expect(hasMenuPermission(user, 'store.customer-management')).toBe(false);
    expect(hasPermission(user, 'store.order-management-other.view')).toBe(false);
    expect(user.permissions).toEqual([]);
  });
  for (const url of [
    'http://127.0.0.1:5173/',
    'http://127.0.0.1:5174/',
    'http://127.0.0.1:5176/',
    'http://example.com:5175/',
    'https://localhost:5175/',
  ]) {
    it(`retains real permission requirements at ${url}`, () => {
      location(url);
      expect(hasMenuPermission(user, 'store.order-management.sales')).toBe(false);
      expect(hasPermission(user, 'store.order-management.sales.pending.create')).toBe(false);
    });
  }
  it('never grants platform, supplier or supply-chain identities', () => {
    location();
    for (const other of [
      { ...user, tenantId: undefined, storeId: undefined },
      { ...user, storeType: 'slabSupplier' as const },
      { ...user, clientCode: 'supply-chain' as const },
    ])
      expect(hasMenuPermission(other, 'store.order-management.sales')).toBe(false);
  });
  it('disables the exception in production builds', () => {
    location();
    vi.stubEnv('DEV', false);
    expect(hasPermission(user, 'store.order-management.sales.pending.create')).toBe(false);
  });
  it('retains ordinary order grants outside the preview', () => {
    location('http://127.0.0.1:5173/');
    expect(
      hasPermission(
        { ...user, permissions: ['store.order-management.sales.pending.view'] },
        'store.order-management.sales.pending.view',
      ),
    ).toBe(true);
  });
  it('does not grant anything without a browser location', () => {
    vi.stubGlobal('window', undefined);
    expect(canPreviewStoreOrders(user, 'store.order-management')).toBe(false);
  });
});
