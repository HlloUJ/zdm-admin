import { describe, expect, it } from 'vitest';

import {
  collectFunctionCatalogRows,
  filterFunctionCatalogByAudience,
  filterFunctionCatalogByPermissions,
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
  it('publishes the confirmed menu hierarchy and exposes the full catalog during development', () => {
    expect(fullFunctionCatalog).toHaveLength(5);
    expect(terminalFunctionTrees.store.map((module) => module.value)).toEqual(
      fullFunctionCatalog.map((module) => module.value),
    );
    expect(terminalFunctionTrees.supplier.map((module) => module.value)).toEqual(
      fullFunctionCatalog.map((module) => module.value),
    );
    expect(fullFunctionCatalog.map((module) => module.label)).toEqual([
      '租户与门店',
      '商品管理',
      '供应商管理',
      '门店分类管理',
      '权限管理',
    ]);
    expect(fullFunctionCatalog[0]).toMatchObject({
      label: '租户与门店',
      value: 'admin.tenant',
      menus: [
        {
          label: '租户管理',
          direct: false,
          pages: [{ label: '租户管理页', tabs: [{ label: '运营中' }, { label: '已归档' }] }],
        },
        {
          label: '门店管理',
          direct: false,
          pages: [{ label: '门店管理页', tabs: [{ label: '运营中' }, { label: '已归档' }] }],
        },
        {
          label: '门店基础数据',
          pages: [{ label: '门店级别管理页', thirdMenuLabel: '门店级别管理', tabs: [] }],
        },
      ],
    });
    expect(fullFunctionCatalog[2]).toMatchObject({
      label: '供应商管理',
      value: 'admin.supplier-management',
      menus: [
        {
          direct: true,
          pages: [{ label: '供应商管理页', tabs: [] }],
        },
      ],
    });
    expect(fullFunctionCatalog[3]).toMatchObject({
      label: '门店分类管理',
      value: 'admin.tenant.store-category-management',
      menus: [
        {
          direct: true,
          pages: [{ label: '门店分类管理页', tabs: [] }],
        },
      ],
    });
    expect(fullFunctionCatalog[1]).toMatchObject({
      label: '商品管理',
      menus: [
        {
          label: '大板管理',
          direct: false,
          pages: [
            {
              label: '大板管理页',
              tabs: [
                { label: '仓库中' },
                { label: '出售中' },
                { label: '已下架' },
                { label: '已售完' },
                { label: '回收站' },
              ],
            },
          ],
        },
        {
          label: '商品公共基础数据',
          direct: false,
          pages: [
            {
              label: '商品分类管理页',
              thirdMenuLabel: '商品分类管理',
              tabs: [{ label: '成品现货分类' }, { label: '配件分类' }],
            },
            {
              label: '属性库管理页',
              thirdMenuLabel: '属性库管理',
              tabs: [{ label: '共享基础属性' }, { label: '成品现货专属属性' }, { label: '配件专属属性' }],
            },
            {
              label: '属性值管理页',
              thirdMenuLabel: '属性值管理',
              tabs: [{ label: '共享基础属性值' }, { label: '成品现货专属值' }, { label: '配件专属值' }],
            },
            {
              label: '分类属性模板页',
              thirdMenuLabel: '分类属性模板',
              tabs: [{ label: '成品现货模板' }, { label: '配件模板' }],
            },
            {
              label: '价格配置页',
              thirdMenuLabel: '价格配置',
              tabs: [{ label: '成品价格配置' }, { label: '大板价格配置' }],
            },
          ],
        },
        {
          label: '成品现货基础数据',
          direct: false,
          pages: [{ label: '成品现货工艺管理页', thirdMenuLabel: '工艺管理', tabs: [] }],
        },
        {
          label: '大板基础数据',
          direct: false,
          pages: [
            { label: '品种管理页', thirdMenuLabel: '品种管理', tabs: [] },
            { label: '产地管理页', thirdMenuLabel: '产地管理', tabs: [] },
            { label: '纹理管理页', thirdMenuLabel: '纹理管理', tabs: [] },
            { label: '色系管理页', thirdMenuLabel: '色系管理', tabs: [] },
            { label: '等级管理页', thirdMenuLabel: '等级管理', tabs: [] },
          ],
        },
      ],
    });
    expect(fullFunctionCatalog[4]).toMatchObject({
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
              tabs: [],
            },
          ],
        },
      ],
    });
    expect(
      collectFunctionCatalogRows(fullFunctionCatalog[0])
        .filter((row) => row.showMenu)
        .map((row) => row.menuLabel),
    ).toEqual(['租户管理', '门店管理', '门店基础数据']);
    expect(
      collectFunctionCatalogRows(fullFunctionCatalog[0])
        .filter((row) => row.showThirdMenu)
        .map((row) => row.thirdMenuLabel),
    ).toEqual([undefined, undefined, '门店级别管理']);
    expect(
      collectFunctionCatalogRows(fullFunctionCatalog[1])
        .filter((row) => row.showMenu)
        .map((row) => row.menuLabel),
    ).toEqual(['大板管理', '商品公共基础数据', '成品现货基础数据', '大板基础数据']);
    expect(
      collectFunctionCatalogRows(fullFunctionCatalog[1])
        .filter((row) => row.showThirdMenu)
        .map((row) => row.thirdMenuLabel),
    ).toEqual([
      undefined,
      '商品分类管理',
      '属性库管理',
      '属性值管理',
      '分类属性模板',
      '价格配置',
      '工艺管理',
      '品种管理',
      '产地管理',
      '纹理管理',
      '色系管理',
      '等级管理',
    ]);
    expect(
      collectFunctionCatalogRows(fullFunctionCatalog[4])
        .filter((row) => row.showMenu)
        .map((row) => row.menuLabel),
    ).toEqual(['员工管理', '角色管理']);
    expect(
      collectFunctionCatalogRows(fullFunctionCatalog[4])
        .filter((row) => row.showThirdMenu)
        .map((row) => row.thirdMenuLabel),
    ).toEqual([undefined, undefined]);
    const supplierPage = fullFunctionCatalog[2].menus[0].pages[0];
    expect(supplierPage.actions).toEqual([
      { label: '查看', value: 'admin.supplier-management.view' },
      { label: '新增', value: 'admin.supplier-management.create' },
      { label: '供货类型配置', value: 'admin.supplier-management.manage-supply-types' },
      { label: '编辑', value: 'admin.supplier-management.edit' },
      { label: '停用/启用', value: 'admin.supplier-management.toggle-status' },
      { label: '删除', value: 'admin.supplier-management.delete' },
    ]);
    expect(collectFunctionCatalogRows(fullFunctionCatalog[2])).toEqual([
      expect.objectContaining({
        direct: true,
        menuLabel: undefined,
        pageLabel: '供应商管理页',
        tabLabels: [],
        actions: supplierPage.actions,
      }),
    ]);
    const storeCategoryPage = fullFunctionCatalog[3].menus[0].pages[0];
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
    expect(collectFunctionCatalogRows(fullFunctionCatalog[3])).toEqual([
      expect.objectContaining({
        direct: true,
        menuLabel: undefined,
        pageLabel: '门店分类管理页',
        tabLabels: [],
        actions: storeCategoryPage.actions,
      }),
    ]);
    const productModule = fullFunctionCatalog[1];
    const productPages = productModule.menus.flatMap((menu) => menu.pages);
    const slabPage = productPages.find((page) => page.value === 'admin.slab-management');
    expect(slabPage?.actions).toEqual([{ label: '操作日志', value: 'admin.slab-management.operation-log.view' }]);
    expect(slabPage?.tabs).toEqual([
      {
        label: '仓库中',
        value: 'admin.slab-management.warehouse',
        actions: [
          { label: '查看', value: 'admin.slab-management.warehouse.view' },
          { label: '发布商品', value: 'admin.slab-management.warehouse.publish' },
          { label: '批量上架', value: 'admin.slab-management.warehouse.batch-shelf' },
          { label: '价格', value: 'admin.slab-management.warehouse.price' },
          { label: '上架', value: 'admin.slab-management.warehouse.shelf' },
          { label: '编辑', value: 'admin.slab-management.warehouse.edit' },
          { label: '删除', value: 'admin.slab-management.warehouse.delete' },
        ],
      },
      {
        label: '出售中',
        value: 'admin.slab-management.selling',
        actions: [
          { label: '查看', value: 'admin.slab-management.selling.view' },
          { label: '发布商品', value: 'admin.slab-management.selling.publish' },
          { label: '批量下架', value: 'admin.slab-management.selling.batch-off-shelf' },
          { label: '价格', value: 'admin.slab-management.selling.price' },
          { label: '下架', value: 'admin.slab-management.selling.off-shelf' },
          { label: '编辑', value: 'admin.slab-management.selling.edit' },
        ],
      },
      {
        label: '已下架',
        value: 'admin.slab-management.off-shelf',
        actions: [
          { label: '查看', value: 'admin.slab-management.off-shelf.view' },
          { label: '批量放回仓库', value: 'admin.slab-management.off-shelf.batch-restore' },
          { label: '详情', value: 'admin.slab-management.off-shelf.detail' },
          { label: '放回仓库', value: 'admin.slab-management.off-shelf.restore' },
          { label: '删除', value: 'admin.slab-management.off-shelf.delete' },
        ],
      },
      {
        label: '已售完',
        value: 'admin.slab-management.sold-out',
        actions: [
          { label: '查看', value: 'admin.slab-management.sold-out.view' },
          { label: '价格', value: 'admin.slab-management.sold-out.price' },
        ],
      },
      {
        label: '回收站',
        value: 'admin.slab-management.recycle',
        actions: [
          { label: '查看', value: 'admin.slab-management.recycle.view' },
          { label: '批量放回仓库', value: 'admin.slab-management.recycle.batch-restore' },
          { label: '批量彻底删除', value: 'admin.slab-management.recycle.batch-purge' },
          { label: '清空回收站', value: 'admin.slab-management.recycle.clear' },
          { label: '价格', value: 'admin.slab-management.recycle.price' },
          { label: '放回仓库', value: 'admin.slab-management.recycle.restore' },
          { label: '彻底删除', value: 'admin.slab-management.recycle.purge' },
        ],
      },
    ]);
    const slabRows = collectFunctionCatalogRows(productModule).filter((row) => row.pageLabel === '大板管理页');
    expect(slabRows.map((row) => row.tabLabels)).toEqual([
      ['页面全局'],
      ['仓库中'],
      ['出售中'],
      ['已下架'],
      ['已售完'],
      ['回收站'],
    ]);
    expect(slabRows[0]).toEqual(
      expect.objectContaining({
        showPage: true,
        pageRowspan: 6,
        selectionLabel: '页面全局权限',
        actions: [{ label: '操作日志', value: 'admin.slab-management.operation-log.view' }],
      }),
    );
    slabRows.slice(1).forEach((row) => {
      expect(row.actions).not.toContainEqual(
        expect.objectContaining({ value: 'admin.slab-management.operation-log.view' }),
      );
    });
    const tenantPage = fullFunctionCatalog[0].menus
      .flatMap((menu) => menu.pages)
      .find((page) => page.value === 'admin.tenant.tenant-management');
    expect(tenantPage?.actions).toEqual([]);
    expect(tenantPage?.tabs).toEqual([
      {
        label: '运营中',
        value: 'admin.tenant.tenant-management.unarchived',
        actions: [
          { label: '查看', value: 'admin.tenant.tenant-management.unarchived.view' },
          { label: '新增', value: 'admin.tenant.tenant-management.unarchived.create' },
          { label: '业务开通', value: 'admin.tenant.tenant-management.unarchived.open-business' },
          { label: '编辑', value: 'admin.tenant.tenant-management.unarchived.edit' },
          { label: '归档', value: 'admin.tenant.tenant-management.unarchived.archive' },
        ],
      },
      {
        label: '已归档',
        value: 'admin.tenant.tenant-management.archived',
        actions: [
          { label: '查看', value: 'admin.tenant.tenant-management.archived.view' },
          { label: '恢复运营', value: 'admin.tenant.tenant-management.archived.restore' },
          { label: '彻底删除', value: 'admin.tenant.tenant-management.archived.delete' },
        ],
      },
    ]);
    const storePage = fullFunctionCatalog[0].menus
      .flatMap((menu) => menu.pages)
      .find((page) => page.value === 'admin.tenant.tenant-store-management');
    expect(storePage?.actions).toEqual([]);
    expect(storePage?.tabs).toEqual([
      {
        label: '运营中',
        value: 'admin.tenant.tenant-store-management.operating',
        actions: [
          { label: '查看', value: 'admin.tenant.tenant-store-management.operating.view' },
          { label: '新增', value: 'admin.tenant.tenant-store-management.operating.create' },
          { label: '修改门店级别', value: 'admin.tenant.tenant-store-management.operating.edit-level' },
          { label: '编辑', value: 'admin.tenant.tenant-store-management.operating.edit' },
          { label: '归档', value: 'admin.tenant.tenant-store-management.operating.archive' },
        ],
      },
      {
        label: '已归档',
        value: 'admin.tenant.tenant-store-management.archived',
        actions: [
          { label: '查看', value: 'admin.tenant.tenant-store-management.archived.view' },
          { label: '恢复运营', value: 'admin.tenant.tenant-store-management.archived.restore' },
          { label: '彻底删除', value: 'admin.tenant.tenant-store-management.archived.delete' },
        ],
      },
    ]);
    const categoryPage = productPages.find((page) => page.value === 'admin.product-data-center.category');
    expect(categoryPage?.tabs).toEqual([
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
    const attributePage = productPages.find((page) => page.value === 'admin.product-data-center.attribute');
    expect(attributePage?.actions).toEqual([]);
    expect(attributePage?.tabs).toEqual(
      ['shared', 'finished', 'accessory'].map((scope, index) => ({
        label: ['共享基础属性', '成品现货专属属性', '配件专属属性'][index],
        value: `admin.product-data-center.attribute.${scope}`,
        actions: productAttributeActions(`admin.product-data-center.attribute.${scope}`),
      })),
    );
    const attributeValuePage = productPages.find((page) => page.value === 'admin.product-data-center.attribute-value');
    expect(attributeValuePage?.actions).toEqual([]);
    expect(attributeValuePage?.tabs).toEqual(
      ['shared', 'finished', 'accessory'].map((scope, index) => ({
        label: ['共享基础属性值', '成品现货专属值', '配件专属值'][index],
        value: `admin.product-data-center.attribute-value.${scope}`,
        actions: productAttributeActions(`admin.product-data-center.attribute-value.${scope}`),
      })),
    );
    const categoryAttributePage = productPages.find(
      (page) => page.value === 'admin.product-data-center.category-attribute-template',
    );
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
    const slabGradePage = productPages.find((page) => page.value === 'admin.product-data-center.slab-grade');
    expect(slabGradePage?.actions).toEqual([
      { label: '查看', value: 'admin.product-data-center.slab-grade.view' },
      { label: '新增', value: 'admin.product-data-center.slab-grade.create' },
      { label: '排序', value: 'admin.product-data-center.slab-grade.sort' },
      { label: '编辑', value: 'admin.product-data-center.slab-grade.edit' },
      { label: '停用/启用', value: 'admin.product-data-center.slab-grade.toggle-status' },
      { label: '删除', value: 'admin.product-data-center.slab-grade.delete' },
    ]);
    expect(getFunctionCatalogPermissionValues(fullFunctionCatalog)).toEqual([
      'admin.tenant.tenant-management.unarchived.view',
      'admin.tenant.tenant-management.unarchived.create',
      'admin.tenant.tenant-management.unarchived.open-business',
      'admin.tenant.tenant-management.unarchived.edit',
      'admin.tenant.tenant-management.unarchived.archive',
      'admin.tenant.tenant-management.archived.view',
      'admin.tenant.tenant-management.archived.restore',
      'admin.tenant.tenant-management.archived.delete',
      'admin.tenant.tenant-store-management.operating.view',
      'admin.tenant.tenant-store-management.operating.create',
      'admin.tenant.tenant-store-management.operating.edit-level',
      'admin.tenant.tenant-store-management.operating.edit',
      'admin.tenant.tenant-store-management.operating.archive',
      'admin.tenant.tenant-store-management.archived.view',
      'admin.tenant.tenant-store-management.archived.restore',
      'admin.tenant.tenant-store-management.archived.delete',
      'admin.tenant.store-level-management.view',
      'admin.tenant.store-level-management.create',
      'admin.tenant.store-level-management.edit',
      'admin.tenant.store-level-management.sort',
      'admin.tenant.store-level-management.toggle-status',
      'admin.tenant.store-level-management.delete',
      'admin.slab-management.operation-log.view',
      'admin.slab-management.warehouse.view',
      'admin.slab-management.warehouse.publish',
      'admin.slab-management.warehouse.batch-shelf',
      'admin.slab-management.warehouse.price',
      'admin.slab-management.warehouse.shelf',
      'admin.slab-management.warehouse.edit',
      'admin.slab-management.warehouse.delete',
      'admin.slab-management.selling.view',
      'admin.slab-management.selling.publish',
      'admin.slab-management.selling.batch-off-shelf',
      'admin.slab-management.selling.price',
      'admin.slab-management.selling.off-shelf',
      'admin.slab-management.selling.edit',
      'admin.slab-management.off-shelf.view',
      'admin.slab-management.off-shelf.batch-restore',
      'admin.slab-management.off-shelf.detail',
      'admin.slab-management.off-shelf.restore',
      'admin.slab-management.off-shelf.delete',
      'admin.slab-management.sold-out.view',
      'admin.slab-management.sold-out.price',
      'admin.slab-management.recycle.view',
      'admin.slab-management.recycle.batch-restore',
      'admin.slab-management.recycle.batch-purge',
      'admin.slab-management.recycle.clear',
      'admin.slab-management.recycle.price',
      'admin.slab-management.recycle.restore',
      'admin.slab-management.recycle.purge',
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
      'admin.product-data-center.markup-configuration.finished.view',
      'admin.product-data-center.markup-configuration.finished.guide-price.edit',
      'admin.product-data-center.markup-configuration.finished.create',
      'admin.product-data-center.markup-configuration.finished.edit',
      'admin.product-data-center.markup-configuration.finished.delete',
      'admin.product-data-center.markup-configuration.slab.view',
      'admin.product-data-center.markup-configuration.slab.guide-price.edit',
      'admin.product-data-center.markup-configuration.slab.create',
      'admin.product-data-center.markup-configuration.slab.edit',
      'admin.product-data-center.markup-configuration.slab.delete',
      'admin.product-data-center.finished-stock-craft.view',
      'admin.product-data-center.finished-stock-craft.create',
      'admin.product-data-center.finished-stock-craft.edit',
      'admin.product-data-center.finished-stock-craft.toggle-status',
      'admin.product-data-center.finished-stock-craft.delete',
      'admin.product-data-center.slab-variety.view',
      'admin.product-data-center.slab-variety.create',
      'admin.product-data-center.slab-variety.edit',
      'admin.product-data-center.slab-variety.toggle-status',
      'admin.product-data-center.slab-variety.delete',
      'admin.product-data-center.slab-origin.view',
      'admin.product-data-center.slab-origin.create',
      'admin.product-data-center.slab-origin.edit',
      'admin.product-data-center.slab-origin.toggle-status',
      'admin.product-data-center.slab-origin.delete',
      'admin.product-data-center.slab-texture.view',
      'admin.product-data-center.slab-texture.create',
      'admin.product-data-center.slab-texture.manage-aliases',
      'admin.product-data-center.slab-texture.edit',
      'admin.product-data-center.slab-texture.toggle-status',
      'admin.product-data-center.slab-texture.delete',
      'admin.product-data-center.slab-color.view',
      'admin.product-data-center.slab-color.create',
      'admin.product-data-center.slab-color.manage-categories',
      'admin.product-data-center.slab-color.edit',
      'admin.product-data-center.slab-color.toggle-status',
      'admin.product-data-center.slab-color.delete',
      'admin.product-data-center.slab-grade.view',
      'admin.product-data-center.slab-grade.create',
      'admin.product-data-center.slab-grade.sort',
      'admin.product-data-center.slab-grade.edit',
      'admin.product-data-center.slab-grade.toggle-status',
      'admin.product-data-center.slab-grade.delete',
      'admin.supplier-management.view',
      'admin.supplier-management.create',
      'admin.supplier-management.manage-supply-types',
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
      'admin.permission-management.employee-management.view',
      'admin.permission-management.employee-management.create',
      'admin.permission-management.employee-management.edit',
      'admin.permission-management.employee-management.permission',
      'admin.permission-management.employee-management.toggle-status',
      'admin.permission-management.employee-management.delete',
      'admin.permission-management.role-management.view',
      'admin.permission-management.role-management.create',
      'admin.permission-management.role-management.edit',
      'admin.permission-management.role-management.permission',
      'admin.permission-management.role-management.delete',
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
      'admin.product-data-center.category.finished.view',
      'admin.product-data-center.category.finished.edit',
      'admin.product-data-center.finished-stock-craft.view',
      'admin.product-data-center.finished-stock-craft.create',
      'admin.tenant.store-category-management.view',
      'admin.tenant.store-category-management.create-root',
      'admin.permission-management.employee-management.view',
      'admin.permission-management.employee-management.permission',
    ]);
    expect(normalizeTerminalPermissions('supplier', ['admin.slab-management.warehouse.view-price'])).toEqual([]);
  });

  it('keeps production audience filters available and limits store roles to terminal grants', () => {
    const operationValues = getFunctionCatalogPermissionValues(filterFunctionCatalogByAudience('admin'));
    expect(operationValues).toContain('admin.slab-management.warehouse.view');
    expect(operationValues).toContain('admin.slab-management.off-shelf.detail');
    expect(operationValues).toContain('admin.slab-management.recycle.price');
    expect(operationValues).toContain('admin.tenant.tenant-management.unarchived.view');
    expect(operationValues).toContain('admin.tenant.store-level-management.view');
    expect(operationValues).toContain('admin.product-data-center.markup-configuration.finished.view');
    expect(operationValues).not.toContain('admin.tenant.store-category-management.view');

    expect(getFunctionCatalogPermissionValues(filterFunctionCatalogByAudience('store'))).not.toContain(
      'admin.product-data-center.markup-configuration.finished.view',
    );
    expect(getFunctionCatalogPermissionValues(filterFunctionCatalogByAudience('supplier'))).not.toContain(
      'admin.product-data-center.markup-configuration.slab.view',
    );
    expect(getFunctionCatalogPermissionValues(terminalFunctionTrees.store)).not.toContain(
      'admin.product-data-center.markup-configuration.finished.view',
    );
    expect(getFunctionCatalogPermissionValues(terminalFunctionTrees.supplier)).not.toContain(
      'admin.product-data-center.markup-configuration.slab.view',
    );
    expect(getFunctionCatalogPermissionValues(terminalFunctionTrees.store)).not.toContain(
      'admin.slab-management.warehouse.view',
    );
    expect(getFunctionCatalogPermissionValues(terminalFunctionTrees.store)).not.toContain(
      'admin.slab-management.off-shelf.detail',
    );
    expect(getFunctionCatalogPermissionValues(terminalFunctionTrees.supplier)).not.toContain(
      'admin.slab-management.recycle.price',
    );

    expect(getFunctionCatalogPermissionValues(terminalFunctionTrees.store)).toContain(
      'admin.tenant.store-level-management.view',
    );
    expect(getFunctionCatalogPermissionValues(terminalFunctionTrees.supplier)).toContain(
      'admin.tenant.store-category-management.view',
    );

    const storeRoleCatalog = filterFunctionCatalogByPermissions(terminalFunctionTrees.store, [
      'admin.tenant.store-category-management.create-root',
    ]);
    expect(getFunctionCatalogPermissionValues(storeRoleCatalog)).toEqual([
      'admin.tenant.store-category-management.view',
      'admin.tenant.store-category-management.create-root',
    ]);
  });

  it('keeps legacy category enable and disable grants as one toggle-status permission', () => {
    expect(
      normalizeTerminalPermissions('store', [
        'admin.tenant.store-category-management.disable',
        'admin.product-data-center.category.finished.enable',
        'admin.product-data-center.category.accessory.disable',
      ]),
    ).toEqual([
      'admin.product-data-center.category.finished.view',
      'admin.product-data-center.category.finished.toggle-status',
      'admin.product-data-center.category.accessory.view',
      'admin.product-data-center.category.accessory.toggle-status',
      'admin.tenant.store-category-management.view',
      'admin.tenant.store-category-management.toggle-status',
    ]);
  });

  it('maps legacy store grants to both tab views but never grants permanent delete implicitly', () => {
    expect(
      normalizeFunctionCatalogPermissions(fullFunctionCatalog, [
        'admin.tenant.tenant-store-management.view',
        'admin.tenant.tenant-store-management.edit',
        'admin.tenant.tenant-store-management.delete',
      ]),
    ).toEqual([
      'admin.tenant.tenant-store-management.operating.view',
      'admin.tenant.tenant-store-management.operating.edit',
      'admin.tenant.tenant-store-management.operating.archive',
      'admin.tenant.tenant-store-management.archived.view',
    ]);
  });

  it('drops the removed legacy store toggle-status permission', () => {
    expect(
      normalizeFunctionCatalogPermissions(fullFunctionCatalog, [
        'admin.tenant.tenant-store-management.toggle-status',
        'admin.tenant.tenant-store-management.operating.toggle-status',
      ]),
    ).toEqual([]);
  });

  it('maps legacy tenant grants to the matching lifecycle tabs and operations', () => {
    expect(
      normalizeFunctionCatalogPermissions(fullFunctionCatalog, [
        'admin.tenant.tenant-management.view',
        'admin.tenant.tenant-management.toggle-status',
        'admin.tenant.tenant-management.delete',
      ]),
    ).toEqual([
      'admin.tenant.tenant-management.unarchived.view',
      'admin.tenant.tenant-management.unarchived.archive',
      'admin.tenant.tenant-management.archived.view',
      'admin.tenant.tenant-management.archived.restore',
      'admin.tenant.tenant-management.archived.delete',
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
