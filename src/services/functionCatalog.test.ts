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
  it('publishes verified supplier, store-category, product-data and permission-management resources to shared consumers', () => {
    expect(terminalFunctionTrees.store).toBe(fullFunctionCatalog);
    expect(terminalFunctionTrees.supplier).toBe(fullFunctionCatalog);
    expect(fullFunctionCatalog).toHaveLength(4);
    expect(fullFunctionCatalog[0]).toMatchObject({
      label: '供应商管理',
      value: 'admin.supplier-management',
      menus: [
        {
          direct: true,
          pages: [{ label: '供应商管理页', tabs: [] }],
        },
      ],
    });
    expect(fullFunctionCatalog[1]).toMatchObject({
      label: '门店分类管理',
      value: 'admin.tenant.store-category-management',
      menus: [
        {
          direct: true,
          pages: [{ label: '门店分类管理页', tabs: [] }],
        },
      ],
    });
    expect(fullFunctionCatalog[2]).toMatchObject({
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
          label: '属性库管理',
          direct: false,
          pages: [
            {
              label: '属性库管理页',
              tabs: [{ label: '共享基础属性' }, { label: '成品现货专属属性' }, { label: '配件专属属性' }],
            },
          ],
        },
        {
          label: '属性值管理',
          direct: false,
          pages: [
            {
              label: '属性值管理页',
              tabs: [{ label: '共享基础属性值' }, { label: '成品现货专属值' }, { label: '配件专属值' }],
            },
          ],
        },
        {
          label: '分类属性模板',
          direct: false,
          pages: [
            {
              label: '分类属性模板页',
              tabs: [{ label: '成品现货模板' }, { label: '配件模板' }],
            },
          ],
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
    expect(fullFunctionCatalog[3]).toMatchObject({
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
    const supplierPage = fullFunctionCatalog[0].menus[0].pages[0];
    expect(supplierPage.actions).toEqual([
      { label: '查看', value: 'admin.supplier-management.view' },
      { label: '新增', value: 'admin.supplier-management.create' },
      { label: '编辑', value: 'admin.supplier-management.edit' },
      { label: '停用/启用', value: 'admin.supplier-management.toggle-status' },
      { label: '删除', value: 'admin.supplier-management.delete' },
    ]);
    expect(collectFunctionCatalogRows(fullFunctionCatalog[0])).toEqual([
      expect.objectContaining({
        direct: true,
        menuLabel: undefined,
        pageLabel: '供应商管理页',
        tabLabels: [],
        actions: supplierPage.actions,
      }),
    ]);
    const storeCategoryPage = fullFunctionCatalog[1].menus[0].pages[0];
    expect(storeCategoryPage.actions).toEqual([
      { label: '查看', value: 'admin.tenant.store-category-management.view' },
      { label: '新增一级分类', value: 'admin.tenant.store-category-management.create-root' },
      { label: '新增下级', value: 'admin.tenant.store-category-management.create-child' },
      { label: '编辑', value: 'admin.tenant.store-category-management.edit' },
      { label: '上移', value: 'admin.tenant.store-category-management.move-up' },
      { label: '下移', value: 'admin.tenant.store-category-management.move-down' },
      { label: '停用/启用', value: 'admin.tenant.store-category-management.toggle-status' },
      { label: '删除', value: 'admin.tenant.store-category-management.delete' },
    ]);
    expect(collectFunctionCatalogRows(fullFunctionCatalog[1])).toEqual([
      expect.objectContaining({
        direct: true,
        menuLabel: undefined,
        pageLabel: '门店分类管理页',
        tabLabels: [],
        actions: storeCategoryPage.actions,
      }),
    ]);
    const categoryPage = fullFunctionCatalog[2].menus[0].pages[0];
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
          { label: '停用/启用', value: 'admin.product-data-center.category.finished.toggle-status' },
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
          { label: '停用/启用', value: 'admin.product-data-center.category.accessory.toggle-status' },
          { label: '删除', value: 'admin.product-data-center.category.accessory.delete' },
        ],
      },
    ]);
    const productAttributeActions = (scope: string) => [
      { label: '查看', value: `${scope}.view` },
      { label: '新增', value: `${scope}.create` },
      { label: '停用/启用', value: `${scope}.toggle-status` },
      { label: '删除', value: `${scope}.delete` },
    ];
    const attributePage = fullFunctionCatalog[2].menus.find(
      (menu) => menu.value === 'admin.product-data-center.attribute.menu',
    )?.pages[0];
    expect(attributePage?.actions).toEqual([]);
    expect(attributePage?.tabs).toEqual(
      ['shared', 'finished', 'accessory'].map((scope, index) => ({
        label: ['共享基础属性', '成品现货专属属性', '配件专属属性'][index],
        value: `admin.product-data-center.attribute.${scope}`,
        actions: productAttributeActions(`admin.product-data-center.attribute.${scope}`),
      })),
    );
    const attributeValuePage = fullFunctionCatalog[2].menus.find(
      (menu) => menu.value === 'admin.product-data-center.attribute-value.menu',
    )?.pages[0];
    expect(attributeValuePage?.actions).toEqual([]);
    expect(attributeValuePage?.tabs).toEqual(
      ['shared', 'finished', 'accessory'].map((scope, index) => ({
        label: ['共享基础属性值', '成品现货专属值', '配件专属值'][index],
        value: `admin.product-data-center.attribute-value.${scope}`,
        actions: productAttributeActions(`admin.product-data-center.attribute-value.${scope}`),
      })),
    );
    const categoryAttributePage = fullFunctionCatalog[2].menus.find(
      (menu) => menu.value === 'admin.product-data-center.category-attribute-template.menu',
    )?.pages[0];
    expect(categoryAttributePage?.actions).toEqual([]);
    expect(categoryAttributePage?.tabs).toEqual(
      ['finished', 'accessory'].map((scope, index) => ({
        label: index === 0 ? '成品现货模板' : '配件模板',
        value: `admin.product-data-center.category-attribute-template.${scope}`,
        actions: [
          { label: '查看', value: `admin.product-data-center.category-attribute-template.${scope}.view` },
          { label: '绑定属性', value: `admin.product-data-center.category-attribute-template.${scope}.create` },
          {
            label: '属性角色',
            value: `admin.product-data-center.category-attribute-template.${scope}.attribute-role`,
          },
          {
            label: '参与SKU组合',
            value: `admin.product-data-center.category-attribute-template.${scope}.sku-combination`,
          },
          { label: '必填', value: `admin.product-data-center.category-attribute-template.${scope}.required` },
          {
            label: '绑定选项值',
            value: `admin.product-data-center.category-attribute-template.${scope}.bind-values`,
          },
          {
            label: '发布/取消发布',
            value: `admin.product-data-center.category-attribute-template.${scope}.toggle-publish`,
          },
          { label: '移除', value: `admin.product-data-center.category-attribute-template.${scope}.delete` },
        ],
      })),
    );
    expect(getFunctionCatalogPermissionValues(fullFunctionCatalog)).toEqual([
      'admin.supplier-management.view',
      'admin.supplier-management.create',
      'admin.supplier-management.edit',
      'admin.supplier-management.toggle-status',
      'admin.supplier-management.delete',
      'admin.tenant.store-category-management.view',
      'admin.tenant.store-category-management.create-root',
      'admin.tenant.store-category-management.create-child',
      'admin.tenant.store-category-management.edit',
      'admin.tenant.store-category-management.move-up',
      'admin.tenant.store-category-management.move-down',
      'admin.tenant.store-category-management.toggle-status',
      'admin.tenant.store-category-management.delete',
      'admin.product-data-center.category.finished.view',
      'admin.product-data-center.category.finished.create-root',
      'admin.product-data-center.category.finished.create-child',
      'admin.product-data-center.category.finished.edit',
      'admin.product-data-center.category.finished.move-up',
      'admin.product-data-center.category.finished.move-down',
      'admin.product-data-center.category.finished.toggle-status',
      'admin.product-data-center.category.finished.delete',
      'admin.product-data-center.category.accessory.view',
      'admin.product-data-center.category.accessory.create-root',
      'admin.product-data-center.category.accessory.create-child',
      'admin.product-data-center.category.accessory.edit',
      'admin.product-data-center.category.accessory.move-up',
      'admin.product-data-center.category.accessory.move-down',
      'admin.product-data-center.category.accessory.toggle-status',
      'admin.product-data-center.category.accessory.delete',
      'admin.product-data-center.attribute.shared.view',
      'admin.product-data-center.attribute.shared.create',
      'admin.product-data-center.attribute.shared.toggle-status',
      'admin.product-data-center.attribute.shared.delete',
      'admin.product-data-center.attribute.finished.view',
      'admin.product-data-center.attribute.finished.create',
      'admin.product-data-center.attribute.finished.toggle-status',
      'admin.product-data-center.attribute.finished.delete',
      'admin.product-data-center.attribute.accessory.view',
      'admin.product-data-center.attribute.accessory.create',
      'admin.product-data-center.attribute.accessory.toggle-status',
      'admin.product-data-center.attribute.accessory.delete',
      'admin.product-data-center.attribute-value.shared.view',
      'admin.product-data-center.attribute-value.shared.create',
      'admin.product-data-center.attribute-value.shared.toggle-status',
      'admin.product-data-center.attribute-value.shared.delete',
      'admin.product-data-center.attribute-value.finished.view',
      'admin.product-data-center.attribute-value.finished.create',
      'admin.product-data-center.attribute-value.finished.toggle-status',
      'admin.product-data-center.attribute-value.finished.delete',
      'admin.product-data-center.attribute-value.accessory.view',
      'admin.product-data-center.attribute-value.accessory.create',
      'admin.product-data-center.attribute-value.accessory.toggle-status',
      'admin.product-data-center.attribute-value.accessory.delete',
      'admin.product-data-center.category-attribute-template.finished.view',
      'admin.product-data-center.category-attribute-template.finished.create',
      'admin.product-data-center.category-attribute-template.finished.attribute-role',
      'admin.product-data-center.category-attribute-template.finished.sku-combination',
      'admin.product-data-center.category-attribute-template.finished.required',
      'admin.product-data-center.category-attribute-template.finished.bind-values',
      'admin.product-data-center.category-attribute-template.finished.toggle-publish',
      'admin.product-data-center.category-attribute-template.finished.delete',
      'admin.product-data-center.category-attribute-template.accessory.view',
      'admin.product-data-center.category-attribute-template.accessory.create',
      'admin.product-data-center.category-attribute-template.accessory.attribute-role',
      'admin.product-data-center.category-attribute-template.accessory.sku-combination',
      'admin.product-data-center.category-attribute-template.accessory.required',
      'admin.product-data-center.category-attribute-template.accessory.bind-values',
      'admin.product-data-center.category-attribute-template.accessory.toggle-publish',
      'admin.product-data-center.category-attribute-template.accessory.delete',
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
        'admin.tenant.store-category-management.create-root',
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
      'admin.tenant.store-category-management.view',
      'admin.tenant.store-category-management.create-root',
      'admin.product-data-center.category.finished.view',
      'admin.product-data-center.category.finished.edit',
      'admin.product-data-center.finished-stock-craft.view',
      'admin.product-data-center.finished-stock-craft.create',
      'admin.permission-management.employee-management.view',
      'admin.permission-management.employee-management.permission',
    ]);
    expect(normalizeTerminalPermissions('supplier', ['admin.slab-management.warehouse.view-price'])).toEqual([]);
  });

  it('keeps legacy category enable and disable grants as one toggle-status permission', () => {
    expect(
      normalizeTerminalPermissions('store', [
        'admin.tenant.store-category-management.disable',
        'admin.product-data-center.category.finished.enable',
        'admin.product-data-center.category.accessory.disable',
      ]),
    ).toEqual([
      'admin.tenant.store-category-management.view',
      'admin.tenant.store-category-management.toggle-status',
      'admin.product-data-center.category.finished.view',
      'admin.product-data-center.category.finished.toggle-status',
      'admin.product-data-center.category.accessory.view',
      'admin.product-data-center.category.accessory.toggle-status',
    ]);
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
