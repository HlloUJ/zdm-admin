import { describe, expect, it } from 'vitest';

import {
  collectFunctionCatalogRows,
  filterFunctionCatalogByAudience,
  filterFunctionCatalogByPermissions,
  fullFunctionCatalog,
  getFunctionCatalogPermissionValues,
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
  it('keeps platform, supplier and store capabilities in their respective audiences', () => {
    expect(fullFunctionCatalog.map((module) => module.value)).toEqual([
      'admin.tenant',
      'store.finished-stock-management',
      'store.price-configuration',
      'admin.product-data-center',
      'admin.supplier-supply-type-management',
      'supply-chain.products',
      'admin.supplier-management',
      'admin.tenant.store-category-management',
      'admin.permission-management',
    ]);
    expect(terminalFunctionTrees.store.map((module) => module.value)).toEqual([
      'store.finished-stock-management',
      'store.price-configuration',
      'admin.supplier-management',
      'admin.tenant.store-category-management',
      'admin.permission-management',
    ]);
    expect(terminalFunctionTrees.supplier.map((module) => module.value)).toEqual([
      'admin.supplier-management',
      'admin.tenant.store-category-management',
      'admin.permission-management',
    ]);
    const operations = getFunctionCatalogPermissionValues(filterFunctionCatalogByAudience('admin'));
    const source = getFunctionCatalogPermissionValues(terminalFunctionTrees['supply-chain']);
    expect(operations).toContain('admin.product-data-center.markup-configuration.slab.guide-price.edit');
    expect(operations).not.toContain('admin.supplier-management.view');
    expect(source).toContain('admin.supplier-management.create');
    expect(source).not.toContain('admin.supplier-supply-type-management.create');
    for (const module of ['finished-stock-management', 'slab-management']) {
      const sourcePage = terminalFunctionTrees['supply-chain']
        .flatMap((m) => m.menus)
        .flatMap((m) => m.pages)
        .find((p) => p.value === `supply-chain.${module}`)!;
      expect(sourcePage.tabs.map((tab) => tab.label)).toEqual(['仓库中', '已上架', '已下架', '已售完', '回收站']);
      expect(source).toContain(`supply-chain.${module}.warehouse.publish`);
      expect(source).toContain(`supply-chain.${module}.warehouse.shelf`);
      expect(source).toContain(`supply-chain.${module}.selling.off-shelf`);
      expect(source).toContain(`supply-chain.${module}.off-shelf.restore`);
      expect(source).not.toContain(`supply-chain.${module}.sold-out.edit`);
      expect(source).not.toContain(`supply-chain.${module}.sold-out.delete`);
      expect(source).not.toContain(`supply-chain.${module}.warehouse.price`);
      expect(operations).toContain(`admin.${module}.warehouse.price`);
      expect(operations).not.toContain(`admin.${module}.warehouse.publish`);
      expect(operations).not.toContain(`admin.${module}.selling.edit`);
      expect(normalizeTerminalPermissions('supply-chain', [`admin.${module}.warehouse.price`])).toEqual([]);
    }
  });

  it('assigns store finished stock as a direct menu with five tabs and separate role pricing', () => {
    const stock = terminalFunctionTrees.store.find((module) => module.value === 'store.finished-stock-management')!;
    expect(stock.menus[0].direct).toBe(true);
    expect(stock.menus[0].pages[0].tabs.map((tab) => tab.label)).toEqual([
      '仓库中',
      '出售中',
      '已下架',
      '已售完',
      '回收站',
    ]);
    const storeValues = getFunctionCatalogPermissionValues(terminalFunctionTrees.store);
    expect(storeValues).toContain('store.finished-stock-management.warehouse.select');
    expect(storeValues).toContain('store.finished-stock-management.selling.off-shelf');
    expect(storeValues).not.toContain('store.finished-stock-management.selling.delete');
    const pricing = terminalFunctionTrees.store.find((module) => module.value === 'store.price-configuration')!;
    expect(pricing.menus[0].direct).toBe(true);
    expect(pricing.menus[0].pages[0].tabs).toEqual([]);
    expect(storeValues).toContain('store.price-configuration.view');
    for (const audience of ['admin', 'supplier', 'supply-chain'] as const) {
      const values = getFunctionCatalogPermissionValues(filterFunctionCatalogByAudience(audience));
      expect(values.some((value) => value.startsWith('store.'))).toBe(false);
    }
  });

  it('publishes supply-chain staff management without platform or store access', () => {
    const pages = terminalFunctionTrees['supply-chain'].flatMap((m) => m.menus).flatMap((m) => m.pages);
    for (const [key, labels] of Object.entries({
      'employee-management': ['查看', '邀请员工', '编辑', '角色', '停用/启用', '删除'],
      'role-management': ['查看', '新增', '编辑', '权限', '删除'],
    })) {
      const prefix = `admin.permission-management.${key}`;
      const page = pages.find((p) => p.value === prefix)!;
      expect(page.tabs).toHaveLength(1);
      expect(page.tabs[0].label).toBe('');
      expect(page.tabs[0].actions.map((a) => a.label)).toEqual(labels);
      expect(page.tabs[0].actions.every((a) => a.value.startsWith(`${prefix}.supply-chain.`))).toBe(true);
      expect(normalizeTerminalPermissions('supply-chain', [`${prefix}.view`])).toEqual([]);
      for (const terminal of ['store', 'supplier'] as const) {
        expect(normalizeTerminalPermissions(terminal, [`${prefix}.supply-chain.view`])).toEqual([]);
      }
    }
  });

  it('keeps the shared supply type dictionary configuration on the platform only', () => {
    const action = 'admin.supplier-supply-type-management.create';
    const menu = fullFunctionCatalog
      .find((module) => module.value === 'admin.supplier-supply-type-management')
      ?.menus.find((entry) => entry.value === 'admin.supplier-supply-type-management.menu');
    expect(menu).toMatchObject({ direct: true });
    expect(menu?.pages[0]?.actions.map((action) => [action.label, action.value])).toEqual([
      ['查看', 'admin.supplier-supply-type-management.view'],
      ['新增', 'admin.supplier-supply-type-management.create'],
      ['编辑', 'admin.supplier-supply-type-management.edit'],
      ['停用/启用', 'admin.supplier-supply-type-management.toggle-status'],
      ['删除', 'admin.supplier-supply-type-management.delete'],
    ]);
    expect(getFunctionCatalogPermissionValues(filterFunctionCatalogByAudience('admin'))).toContain(action);
    for (const terminal of ['store', 'supplier'] as const) {
      expect(getFunctionCatalogPermissionValues(terminalFunctionTrees[terminal])).not.toContain(action);
      expect(normalizeTerminalPermissions(terminal, [action])).toEqual([]);
    }
  });

  it('keeps terminal names and accepts only permissions present in the published catalog', () => {
    expect(terminalTabs).toEqual([
      { label: '城市合伙人门店管理后台', value: 'store' },
      { label: '大板供应商门店管理后台', value: 'supplier' },
      { label: '供应链协同系统', value: 'supply-chain' },
    ]);
    expect(
      normalizeTerminalPermissions('store', [
        'admin.tenant.store-category-management.create-root',
        'store.goods.finished-stock.查询',
        'admin.permission-management.employee-management.query',
        'admin.permission-management.employee-management.reset',
        'admin.permission-management.employee-management.permission',
      ]),
    ).toEqual([
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

    expect(getFunctionCatalogPermissionValues(terminalFunctionTrees.store)).not.toContain(
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
    ).toEqual(['admin.tenant.store-category-management.view', 'admin.tenant.store-category-management.toggle-status']);
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

describe('finished stock catalog contract', () => {
  it('registers the real tabs and actions in page order', () => {
    const page = fullFunctionCatalog
      .flatMap((m) => m.menus)
      .find((m) => m.value === 'admin.finished-stock-management.menu')!.pages[0];
    expect(
      page.tabs.map((tab) => [tab.label, tab.value, tab.actions.map((action) => [action.label, action.value])]),
    ).toEqual([
      [
        '仓库中',
        'admin.finished-stock-management.warehouse',
        [
          ['查看', 'admin.finished-stock-management.warehouse.view'],
          ['批量上架', 'admin.finished-stock-management.warehouse.batch-shelf'],
          ['详情', 'admin.finished-stock-management.warehouse.detail'],
          ['价格', 'admin.finished-stock-management.warehouse.price'],
          ['上架', 'admin.finished-stock-management.warehouse.shelf'],
          ['删除', 'admin.finished-stock-management.warehouse.delete'],
        ],
      ],
      [
        '已上架',
        'admin.finished-stock-management.selling',
        [
          ['查看', 'admin.finished-stock-management.selling.view'],
          ['批量下架', 'admin.finished-stock-management.selling.batch-off-shelf'],
          ['详情', 'admin.finished-stock-management.selling.detail'],
          ['价格', 'admin.finished-stock-management.selling.price'],
          ['下架', 'admin.finished-stock-management.selling.off-shelf'],
        ],
      ],
      [
        '已下架',
        'admin.finished-stock-management.off-shelf',
        [
          ['查看', 'admin.finished-stock-management.off-shelf.view'],
          ['批量放回到仓库', 'admin.finished-stock-management.off-shelf.batch-restore'],
          ['详情', 'admin.finished-stock-management.off-shelf.detail'],
          ['放回仓库', 'admin.finished-stock-management.off-shelf.restore'],
          ['删除', 'admin.finished-stock-management.off-shelf.delete'],
        ],
      ],
      [
        '已售完',
        'admin.finished-stock-management.sold-out',
        [
          ['查看', 'admin.finished-stock-management.sold-out.view'],
          ['详情', 'admin.finished-stock-management.sold-out.detail'],
          ['价格', 'admin.finished-stock-management.sold-out.price'],
        ],
      ],
      [
        '回收站',
        'admin.finished-stock-management.recycle',
        [
          ['查看', 'admin.finished-stock-management.recycle.view'],
          ['批量放回到仓库', 'admin.finished-stock-management.recycle.batch-restore'],
          ['批量彻底删除', 'admin.finished-stock-management.recycle.batch-purge'],
          ['清空回收站', 'admin.finished-stock-management.recycle.clear'],
          ['详情', 'admin.finished-stock-management.recycle.detail'],
          ['价格', 'admin.finished-stock-management.recycle.price'],
          ['放回仓库', 'admin.finished-stock-management.recycle.restore'],
          ['彻底删除', 'admin.finished-stock-management.recycle.purge'],
        ],
      ],
    ]);
    expect(page.tabs.flatMap((tab) => tab.actions)).toHaveLength(27);
    expect(page.actions).toEqual([{ label: '操作日志', value: 'admin.finished-stock-management.operation-log.view' }]);
    const values = getFunctionCatalogPermissionValues(fullFunctionCatalog).filter((value) =>
      value.startsWith('admin.finished-stock-management.'),
    );
    expect(values).toHaveLength(28);
    expect(new Set(values).size).toBe(28);
    expect(page.tabs.flatMap((tab) => tab.actions).some((action) => ['查询', '重置'].includes(action.label))).toBe(
      false,
    );
    expect(
      normalizeFunctionCatalogPermissions(fullFunctionCatalog, ['admin.finished-stock-management.selling.edit']),
    ).toEqual([]);
    expect(getFunctionCatalogPermissionValues(filterFunctionCatalogByAudience('admin'))).toEqual(
      expect.arrayContaining(values),
    );
    for (const audience of ['store', 'supplier'] as const) {
      expect(
        getFunctionCatalogPermissionValues(filterFunctionCatalogByAudience(audience)).filter((value) =>
          value.startsWith('admin.finished-stock-management.'),
        ),
      ).toEqual([]);
    }
  });
});

describe('supplier supply type catalog', () => {
  it('registers exactly the page actions and excludes business terminals', () => {
    const module = fullFunctionCatalog.find((item) => item.value === 'admin.supplier-supply-type-management');
    expect(module?.menus[0].direct).toBe(true);
    expect(module?.menus[0].pages[0].tabs).toEqual([]);
    expect(module?.menus[0].pages[0].actions).toEqual([
      { label: '查看', value: 'admin.supplier-supply-type-management.view' },
      { label: '新增', value: 'admin.supplier-supply-type-management.create' },
      { label: '编辑', value: 'admin.supplier-supply-type-management.edit' },
      { label: '停用/启用', value: 'admin.supplier-supply-type-management.toggle-status' },
      { label: '删除', value: 'admin.supplier-supply-type-management.delete' },
    ]);
    for (const tree of Object.values(terminalFunctionTrees)) {
      expect(tree.some((item) => item.value === module?.value)).toBe(false);
    }
  });
});

describe('category sorting permissions', () => {
  it('registers sorting for both category and template scopes and removes movement actions', () => {
    const values = getFunctionCatalogPermissionValues(fullFunctionCatalog);
    for (const scope of ['finished', 'accessory']) {
      const prefix = `admin.product-data-center.category.${scope}`;
      expect(values).toContain(`${prefix}.sort`);
      expect(values).not.toContain(`${prefix}.move-up`);
      expect(values).not.toContain(`${prefix}.move-down`);
      expect(values).toContain(`admin.product-data-center.category-attribute-template.${scope}.attributes.sort`);
      expect(
        normalizeFunctionCatalogPermissions(fullFunctionCatalog, [`${prefix}.move-up`, `${prefix}.move-down`]),
      ).toEqual([`${prefix}.view`, `${prefix}.sort`]);
    }
    expect(values).toContain('admin.tenant.store-category-management.move-up');
    expect(values).toContain('admin.tenant.store-category-management.move-down');
  });
});

describe('slab operations details', () => {
  it('registers a detail per operations tab without expanding supply chain or terminal grants', () => {
    const page = fullFunctionCatalog
      .flatMap((module) => module.menus)
      .flatMap((menu) => menu.pages)
      .find((item) => item.value === 'admin.slab-management')!;
    expect(page.tabs.map((tab) => tab.label)).toEqual(['仓库中', '已上架', '已下架', '已售完', '回收站']);
    for (const tab of page.tabs) {
      expect(tab.actions.filter((action) => action.value.endsWith('.detail'))).toEqual([
        { label: '详情', value: `${tab.value}.detail` },
      ]);
      expect(tab.actions.some((action) => ['查询', '重置'].includes(action.label))).toBe(false);
    }
    for (const terminal of Object.values(terminalFunctionTrees)) {
      expect(
        getFunctionCatalogPermissionValues(terminal).filter((value) => value.startsWith('admin.slab-management.')),
      ).toEqual([]);
    }
  });
});
