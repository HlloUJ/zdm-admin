import { describe, expect, it } from 'vitest';

import {
  collectFunctionCatalogRows,
  fullFunctionCatalog,
  getFunctionCatalogPermissionValues,
  initialAllocationValues,
  normalizeFunctionCatalogPermissions,
  normalizeTerminalPermissions,
  terminalFunctionTrees,
  terminalTabs,
  withDefaultViewPermissions,
  type FunctionModule,
} from './functionCatalog';

const catalogFixture: FunctionModule[] = [
  {
    label: '示例模块',
    value: 'example',
    menus: [
      {
        label: '示例菜单',
        value: 'example.menu',
        direct: false,
        pages: [
          {
            label: '示例页面',
            value: 'example.page',
            actions: [],
            tabs: [
              {
                label: 'Tab A',
                value: 'example.page.tab-a',
                actions: [{ label: '查询', value: 'example.page.tab-a.query' }],
              },
              {
                label: 'Tab B',
                value: 'example.page.tab-b',
                actions: [{ label: '编辑', value: 'example.page.tab-b.edit' }],
              },
            ],
          },
        ],
      },
    ],
  },
];

describe('full function catalog', () => {
  it('publishes verified craft, employee, and role management resources to shared consumers', () => {
    expect(terminalFunctionTrees.store).toBe(fullFunctionCatalog);
    expect(terminalFunctionTrees.supplier).toBe(fullFunctionCatalog);
    expect(fullFunctionCatalog).toHaveLength(2);
    expect(fullFunctionCatalog[0]).toMatchObject({
      label: '商品基础数据中心',
      menus: [
        {
          label: '成品现货工艺管理',
          direct: false,
          pages: [{ label: '成品现货工艺管理页', tabs: [] }],
        },
      ],
    });
    expect(fullFunctionCatalog[1]).toMatchObject({
      label: '权限管理',
      menus: [
        {
          label: '员工管理',
          direct: false,
          pages: [{ label: '员工管理页', tabs: [] }],
        },
        {
          label: '角色管理',
          direct: false,
          pages: [
            {
              label: '角色管理页',
              tabs: [{ label: '运营管理平台角色' }, { label: '城市合伙人门店角色' }, { label: '大板供应商门店角色' }],
            },
          ],
        },
      ],
    });
    expect(getFunctionCatalogPermissionValues(fullFunctionCatalog)).toEqual([
      'admin.product-data-center.finished-stock-craft.view',
      'admin.permission-management.employee-management.view',
      'admin.permission-management.employee-management.create',
      'admin.permission-management.employee-management.edit',
      'admin.permission-management.employee-management.permission',
      'admin.permission-management.employee-management.toggle-status',
      'admin.permission-management.employee-management.delete',
      'admin.permission-management.role-management.operation-platform.view',
      'admin.permission-management.role-management.operation-platform.create',
      'admin.permission-management.role-management.operation-platform.edit',
      'admin.permission-management.role-management.operation-platform.permission',
      'admin.permission-management.role-management.operation-platform.delete',
      'admin.permission-management.role-management.partner-store.view',
      'admin.permission-management.role-management.partner-store.create',
      'admin.permission-management.role-management.partner-store.edit',
      'admin.permission-management.role-management.partner-store.delete',
      'admin.permission-management.role-management.supplier-store.view',
      'admin.permission-management.role-management.supplier-store.create',
      'admin.permission-management.role-management.supplier-store.edit',
      'admin.permission-management.role-management.supplier-store.delete',
    ]);
    expect(initialAllocationValues).toEqual({ store: [], supplier: [] });
  });

  it('keeps terminal names and accepts only permissions present in the published catalog', () => {
    expect(terminalTabs).toEqual([
      { label: '城市合伙人门店管理后台', value: 'store' },
      { label: '大板供应商门店管理后台', value: 'supplier' },
    ]);
    expect(
      normalizeTerminalPermissions('store', [
        'store.goods.finished-stock.查询',
        'admin.product-data-center.finished-stock-craft.query',
        'admin.product-data-center.finished-stock-craft.reset',
        'admin.product-data-center.finished-stock-craft.create',
        'admin.permission-management.employee-management.query',
        'admin.permission-management.employee-management.reset',
        'admin.permission-management.employee-management.permission',
      ]),
    ).toEqual([
      'admin.product-data-center.finished-stock-craft.view',
      'admin.permission-management.employee-management.view',
      'admin.permission-management.employee-management.permission',
    ]);
    expect(normalizeTerminalPermissions('supplier', ['admin.slab-management.warehouse.view-price'])).toEqual([]);
  });

  it('generates view permissions and enforces operation dependencies for every future page or tab', () => {
    const normalizedFixture = withDefaultViewPermissions(catalogFixture);

    expect(getFunctionCatalogPermissionValues(normalizedFixture)).toEqual([
      'example.page.tab-a.view',
      'example.page.tab-b.view',
      'example.page.tab-b.edit',
    ]);
    expect(normalizeFunctionCatalogPermissions(normalizedFixture, ['example.page.tab-b.edit'])).toEqual([
      'example.page.tab-b.view',
      'example.page.tab-b.edit',
    ]);
    expect(
      normalizeFunctionCatalogPermissions(normalizedFixture, ['example.page.tab-a.query', 'example.page.tab-a.reset']),
    ).toEqual(['example.page.tab-a.view']);
    expect(collectFunctionCatalogRows(normalizedFixture[0])).toEqual([
      expect.objectContaining({
        menuLabel: '示例菜单',
        showMenu: true,
        menuRowspan: 2,
        pageLabel: '示例页面',
        showPage: true,
        pageRowspan: 2,
        tabLabels: ['Tab A'],
      }),
      expect.objectContaining({
        menuLabel: '示例菜单',
        showMenu: false,
        menuRowspan: 2,
        pageLabel: '示例页面',
        showPage: false,
        pageRowspan: 2,
        tabLabels: ['Tab B'],
      }),
    ]);
  });
});
