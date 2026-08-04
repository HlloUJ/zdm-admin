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
  it('publishes verified product-data and permission-management resources to shared consumers', () => {
    expect(terminalFunctionTrees.store).toBe(fullFunctionCatalog);
    expect(terminalFunctionTrees.supplier).toBe(fullFunctionCatalog);
    expect(fullFunctionCatalog).toHaveLength(2);
    expect(fullFunctionCatalog[0]).toMatchObject({
      label: '商品基础数据中心',
      menus: [
        {
          label: '商品分类管理',
          direct: false,
          pages: [
            {
              label: '商品分类管理页',
              tabs: [{ label: '成品现货分类' }, { label: '配件分类' }],
            },
          ],
        },
        {
          label: '类目属性模板',
          direct: false,
          pages: [{ label: '类目属性模板页', tabs: [] }],
        },
        {
          label: '大板品种管理',
          direct: false,
          pages: [{ label: '大板品种管理页', tabs: [] }],
        },
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
    const categoryPage = fullFunctionCatalog[0].menus[0].pages[0];
    expect(categoryPage.tabs).toEqual([
      {
        label: '成品现货分类',
        value: 'admin.product-data-center.category.finished',
        actions: [
          { label: '查看', value: 'admin.product-data-center.category.finished.view' },
          { label: '新增一级分类', value: 'admin.product-data-center.category.finished.create-root' },
          { label: '新增下级', value: 'admin.product-data-center.category.finished.create-child' },
          { label: '编辑', value: 'admin.product-data-center.category.finished.edit' },
          { label: '上移', value: 'admin.product-data-center.category.finished.move-up' },
          { label: '下移', value: 'admin.product-data-center.category.finished.move-down' },
          { label: '停用', value: 'admin.product-data-center.category.finished.disable' },
          { label: '启用', value: 'admin.product-data-center.category.finished.enable' },
          { label: '删除', value: 'admin.product-data-center.category.finished.delete' },
        ],
      },
      {
        label: '配件分类',
        value: 'admin.product-data-center.category.accessory',
        actions: [
          { label: '查看', value: 'admin.product-data-center.category.accessory.view' },
          { label: '新增一级分类', value: 'admin.product-data-center.category.accessory.create-root' },
          { label: '新增下级', value: 'admin.product-data-center.category.accessory.create-child' },
          { label: '编辑', value: 'admin.product-data-center.category.accessory.edit' },
          { label: '上移', value: 'admin.product-data-center.category.accessory.move-up' },
          { label: '下移', value: 'admin.product-data-center.category.accessory.move-down' },
          { label: '停用', value: 'admin.product-data-center.category.accessory.disable' },
          { label: '启用', value: 'admin.product-data-center.category.accessory.enable' },
          { label: '删除', value: 'admin.product-data-center.category.accessory.delete' },
        ],
      },
    ]);
    const categoryAttributePage = fullFunctionCatalog[0].menus.find(
      (menu) => menu.value === 'admin.product-data-center.category-attribute-template.menu',
    )?.pages[0];
    expect(categoryAttributePage?.actions).toEqual([
      { label: '查看', value: 'admin.product-data-center.category-attribute-template.view' },
      { label: '绑定属性', value: 'admin.product-data-center.category-attribute-template.create' },
      { label: '编辑', value: 'admin.product-data-center.category-attribute-template.edit' },
      { label: '移除', value: 'admin.product-data-center.category-attribute-template.delete' },
    ]);
    expect(getFunctionCatalogPermissionValues(fullFunctionCatalog)).toEqual([
      'admin.product-data-center.category.finished.view',
      'admin.product-data-center.category.finished.create-root',
      'admin.product-data-center.category.finished.create-child',
      'admin.product-data-center.category.finished.edit',
      'admin.product-data-center.category.finished.move-up',
      'admin.product-data-center.category.finished.move-down',
      'admin.product-data-center.category.finished.disable',
      'admin.product-data-center.category.finished.enable',
      'admin.product-data-center.category.finished.delete',
      'admin.product-data-center.category.accessory.view',
      'admin.product-data-center.category.accessory.create-root',
      'admin.product-data-center.category.accessory.create-child',
      'admin.product-data-center.category.accessory.edit',
      'admin.product-data-center.category.accessory.move-up',
      'admin.product-data-center.category.accessory.move-down',
      'admin.product-data-center.category.accessory.disable',
      'admin.product-data-center.category.accessory.enable',
      'admin.product-data-center.category.accessory.delete',
      'admin.product-data-center.category-attribute-template.view',
      'admin.product-data-center.category-attribute-template.create',
      'admin.product-data-center.category-attribute-template.edit',
      'admin.product-data-center.category-attribute-template.delete',
      'admin.product-data-center.slab-variety.view',
      'admin.product-data-center.slab-variety.create',
      'admin.product-data-center.slab-variety.edit',
      'admin.product-data-center.slab-variety.toggle-status',
      'admin.product-data-center.slab-variety.delete',
      'admin.product-data-center.finished-stock-craft.view',
      'admin.product-data-center.finished-stock-craft.create',
      'admin.product-data-center.finished-stock-craft.edit',
      'admin.product-data-center.finished-stock-craft.toggle-status',
      'admin.product-data-center.finished-stock-craft.delete',
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
        'admin.product-data-center.category.finished.edit',
        'store.goods.finished-stock.查询',
        'admin.product-data-center.finished-stock-craft.query',
        'admin.product-data-center.finished-stock-craft.reset',
        'admin.product-data-center.finished-stock-craft.create',
        'admin.product-data-center.finished-stock-craft.preview',
        'admin.permission-management.employee-management.query',
        'admin.permission-management.employee-management.reset',
        'admin.permission-management.employee-management.permission',
      ]),
    ).toEqual([
      'admin.product-data-center.category.finished.view',
      'admin.product-data-center.category.finished.edit',
      'admin.product-data-center.finished-stock-craft.view',
      'admin.product-data-center.finished-stock-craft.create',
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
