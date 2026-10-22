import { describe, expect, it } from 'vitest';
import { terminalFunctionTrees, getRuntimeFunctionCatalog, getFunctionModulePermissionValues } from './functionCatalog';
import { adminMenuEntries } from './adminPermissions';

describe('customer catalog', () => {
  it('publishes exactly the confirmed two tabs and 17 grants on store only', () => {
    const module = terminalFunctionTrees.store.find((item) => item.value === 'store.customer-management')!;
    expect(module.label).toBe('客户管理');
    const tabs = module.menus[0].pages[0].tabs;
    expect(tabs.map((tab) => tab.label)).toEqual(['日常客户', '归档客户']);
    expect(tabs[0].actions.map((action) => action.label)).toEqual([
      '查看',
      '新增',
      '批量调整归属',
      '批量归档',
      '详情',
      '跟进',
      '编辑',
      '归档',
    ]);
    expect(tabs[1].actions.map((action) => action.label)).toEqual([
      '查看',
      '批量调整归属',
      '批量取消归档',
      '批量彻底删除',
      '详情',
      '跟进',
      '编辑',
      '取消归档',
      '彻底删除',
    ]);
    const grants = getFunctionModulePermissionValues(module);
    expect(grants).toHaveLength(17);
    expect(new Set(grants).size).toBe(17);
    expect(grants.some((value) => /query|reset|operation-log|delegate/.test(value))).toBe(false);
    for (const audience of ['admin', 'supplier', 'supply-chain'] as const) {
      expect(getRuntimeFunctionCatalog(audience).some((item) => item.value === module.value)).toBe(false);
    }
  });
  it('places the store-only customer menu immediately below product management', () => {
    const index = adminMenuEntries.findIndex((item) => 'value' in item && item.value === 'store-products');
    expect(adminMenuEntries[index + 1]).toMatchObject({
      label: '客户管理',
      path: '/store/customer-management',
      permissionPrefix: 'store.customer-management',
    });
  });
});
