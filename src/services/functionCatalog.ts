import { isFunctionAllowedForAudience } from './functionAudience';
import { verifiedFunctionCatalog } from './functionCatalogAdminData';
import { storeLevelModule, storeFinishedStock, storePriceConfiguration } from './functionCatalogStoreData';
import { supplyChainProducts, supplyTypeModule } from './functionCatalogSupplyData';
import { expandLegacyScopedPermission } from './functionPermissionCompatibility';

export type TerminalType = 'store' | 'supplier' | 'supply-chain';
export type FunctionAudience = 'admin' | TerminalType;

export interface FunctionAction {
  label: string;
  value: string;
}

export interface FunctionTab {
  label: string;
  parentLabel?: string;
  value: string;
  actions: FunctionAction[];
}

export interface FunctionPage {
  label: string;
  value: string;
  thirdMenuLabel?: string;
  actions: FunctionAction[];
  tabs: FunctionTab[];
  note?: string;
  splitSharedTabs?: boolean;
  audiences?: FunctionAudience[];
}

export interface FunctionMenu {
  label?: string;
  value: string;
  direct: boolean;
  pages: FunctionPage[];
}

export interface FunctionModule {
  label: string;
  value: string;
  audiences?: FunctionAudience[];
  menus: FunctionMenu[];
}

export interface FunctionCatalogRow {
  key: string;
  menuLabel?: string;
  direct: boolean;
  showMenu: boolean;
  menuRowspan: number;
  thirdMenuLabel?: string;
  showThirdMenu: boolean;
  thirdMenuRowspan: number;
  pageLabel: string;
  pageNote?: string;
  showPage: boolean;
  pageRowspan: number;
  tabLabels: string[];
  actions: FunctionAction[];
  selectionLabel: string;
}

export const terminalTabs = [
  { label: '城市合伙人门店管理后台', value: 'store' },
  { label: '大板供应商门店管理后台', value: 'supplier' },
  { label: '供应链协同系统', value: 'supply-chain' },
];

const isLegacyReadAction = (action: FunctionAction) =>
  action.value.endsWith('.query') ||
  action.value.endsWith('.查询') ||
  action.value.endsWith('.reset') ||
  action.value.endsWith('.重置');

export const isViewPermission = (value: string) => value.endsWith('.view');

const withDefaultViewAction = (scope: string, actions: FunctionAction[]) => [
  { label: '查看', value: `${scope}.view` },
  ...actions.filter((action) => !isViewPermission(action.value) && !isLegacyReadAction(action)),
];

export const withDefaultViewPermissions = (modules: FunctionModule[]): FunctionModule[] =>
  modules.map((module) => ({
    ...module,
    menus: module.menus.map((menu) => ({
      ...menu,
      pages: menu.pages.map((page) => ({
        ...page,
        actions: page.tabs.length
          ? page.actions.filter((action) => !isLegacyReadAction(action))
          : withDefaultViewAction(page.value, page.actions),
        tabs: page.tabs.map((tab) => ({
          ...tab,
          actions: withDefaultViewAction(tab.value, tab.actions),
        })),
      })),
    })),
  }));

const applyConfirmedNavigationStructure = (modules: FunctionModule[]): FunctionModule[] =>
  modules.map((module) => {
    if (module.value !== 'admin.product-data-center') return module;

    const commonValues = new Set([
      'admin.product-data-center.category.menu',
      'admin.product-data-center.attribute.menu',
      'admin.product-data-center.attribute-value.menu',
      'admin.product-data-center.category-attribute-template.menu',
      'admin.product-data-center.markup-configuration.menu',
    ]);
    const commonMenus = module.menus.filter((menu) => commonValues.has(menu.value));
    const craftMenu = module.menus.find((menu) => menu.value === 'admin.product-data-center.finished-stock-craft.menu');
    const slabMenu = module.menus.find((menu) => menu.value === 'admin.product-data-center.slab-base-data.menu');
    const slabManagementMenu = module.menus.find((menu) => menu.value === 'admin.slab-management.menu');

    return {
      ...module,
      label: '商品管理',
      menus: [
        {
          label: '成品现货管理',
          value: 'admin.finished-stock-management.menu',
          direct: false,
          pages: [
            {
              label: '成品现货管理页',
              value: 'admin.finished-stock-management',
              audiences: ['admin'],
              actions: [{ label: '操作日志', value: 'admin.finished-stock-management.operation-log.view' }],
              tabs: [
                {
                  label: '仓库中',
                  value: 'admin.finished-stock-management.warehouse',
                  actions: [
                    { label: '查看', value: 'admin.finished-stock-management.warehouse.view' },
                    { label: '批量上架', value: 'admin.finished-stock-management.warehouse.batch-shelf' },
                    { label: '上架', value: 'admin.finished-stock-management.warehouse.shelf' },
                    { label: '编辑', value: 'admin.finished-stock-management.warehouse.edit' },
                    { label: '删除', value: 'admin.finished-stock-management.warehouse.delete' },
                  ],
                },
                {
                  label: '已上架',
                  value: 'admin.finished-stock-management.selling',
                  actions: [
                    { label: '查看', value: 'admin.finished-stock-management.selling.view' },
                    { label: '批量下架', value: 'admin.finished-stock-management.selling.batch-off-shelf' },
                    { label: '下架', value: 'admin.finished-stock-management.selling.off-shelf' },
                    { label: '编辑', value: 'admin.finished-stock-management.selling.edit' },
                  ],
                },
                {
                  label: '已下架',
                  value: 'admin.finished-stock-management.off-shelf',
                  actions: [
                    { label: '查看', value: 'admin.finished-stock-management.off-shelf.view' },
                    { label: '批量放回到仓库', value: 'admin.finished-stock-management.off-shelf.batch-restore' },
                    { label: '详情', value: 'admin.finished-stock-management.off-shelf.detail' },
                    { label: '放回仓库', value: 'admin.finished-stock-management.off-shelf.restore' },
                    { label: '删除', value: 'admin.finished-stock-management.off-shelf.delete' },
                  ],
                },
                {
                  label: '已售完',
                  value: 'admin.finished-stock-management.sold-out',
                  actions: [
                    { label: '查看', value: 'admin.finished-stock-management.sold-out.view' },
                    { label: '详情', value: 'admin.finished-stock-management.sold-out.detail' },
                  ],
                },
                {
                  label: '回收站',
                  value: 'admin.finished-stock-management.recycle',
                  actions: [
                    { label: '查看', value: 'admin.finished-stock-management.recycle.view' },
                    { label: '批量放回到仓库', value: 'admin.finished-stock-management.recycle.batch-restore' },
                    { label: '批量彻底删除', value: 'admin.finished-stock-management.recycle.batch-purge' },
                    { label: '清空回收站', value: 'admin.finished-stock-management.recycle.clear' },
                    { label: '详情', value: 'admin.finished-stock-management.recycle.detail' },
                    { label: '放回仓库', value: 'admin.finished-stock-management.recycle.restore' },
                    { label: '彻底删除', value: 'admin.finished-stock-management.recycle.purge' },
                  ],
                },
              ],
            },
          ],
        },
        ...(slabManagementMenu ? [slabManagementMenu] : []),
        {
          label: '商品公共基础数据',
          value: 'admin.product-data-center.common-base-data.menu',
          direct: false,
          pages: commonMenus.flatMap((menu) => menu.pages.map((page) => ({ ...page, thirdMenuLabel: menu.label }))),
        },
        ...(craftMenu
          ? [
              {
                ...craftMenu,
                label: '成品现货基础数据',
                pages: craftMenu.pages.map((page) => ({ ...page, thirdMenuLabel: '工艺管理' })),
              },
            ]
          : []),
        ...(slabMenu ? [{ ...slabMenu, label: '大板基础数据' }] : []),
      ],
    };
  });

const navigationModuleOrder = [
  'admin.tenant',
  'store.finished-stock-management',
  'store.price-configuration',
  'admin.product-data-center',
  'admin.supplier-supply-type-management',
  'supply-chain.products',
  'admin.supplier-management',
  'admin.tenant.store-category-management',
  'admin.permission-management',
];

const orderModulesByNavigation = (modules: FunctionModule[]) => {
  const orderByValue = new Map(navigationModuleOrder.map((value, index) => [value, index]));
  return [...modules].sort(
    (left, right) =>
      (orderByValue.get(left.value) ?? Number.MAX_SAFE_INTEGER) -
      (orderByValue.get(right.value) ?? Number.MAX_SAFE_INTEGER),
  );
};

const withAdministrationTabs = (modules: FunctionModule[]): FunctionModule[] =>
  modules.map((module) => ({
    ...module,
    menus: module.menus.map((menu) => ({
      ...menu,
      pages: menu.pages.map((page) => {
        if (
          !['admin.permission-management.role-management', 'admin.permission-management.employee-management'].includes(
            page.value,
          )
        )
          return page;
        return {
          ...page,
          actions: [],
          tabs: [
            {
              label: '运营管理平台',
              value: page.value,
              actions: page.actions.map((action) => ({
                ...action,
                label: action.label,
              })),
            },
            {
              label: '供应链协同系统',
              value: `${page.value}.supply-chain`,
              actions: page.actions.map((action) => ({
                label: action.label,
                value: action.value.replace(page.value, `${page.value}.supply-chain`),
              })),
            },
          ],
        };
      }),
    })),
  }));

export const fullFunctionCatalog = applyConfirmedNavigationStructure(
  orderModulesByNavigation(
    withDefaultViewPermissions(
      withAdministrationTabs([
        storeLevelModule,
        storeFinishedStock,
        storePriceConfiguration,
        ...verifiedFunctionCatalog,
        supplyChainProducts,
        supplyTypeModule,
      ]),
    ),
  ),
);

const filterCatalogPagesByAudience = (modules: FunctionModule[], audience: FunctionAudience) =>
  modules
    .map((module) => ({
      ...module,
      menus: module.menus
        .map((menu) => ({
          ...menu,
          pages: menu.pages
            .filter((page) => isFunctionAllowedForAudience(page.value, audience))
            .map((page) => ({
              ...page,
              actions: page.actions.filter((action) => isFunctionAllowedForAudience(action.value, audience)),
              tabs: page.tabs
                .map((tab) => ({
                  ...tab,
                  label: audience !== 'admin' && page.value.includes('permission-management') ? '' : tab.label,
                  actions: tab.actions
                    .filter((action) => isFunctionAllowedForAudience(action.value, audience))
                    .map((action) => ({
                      ...action,
                      label:
                        audience !== 'admin' &&
                        action.value === 'admin.permission-management.employee-management.create'
                          ? '邀请员工'
                          : action.label,
                    })),
                }))
                .filter((tab) => tab.actions.length > 0),
            }))
            .map((page) =>
              page.value === 'admin.permission-management.role-management' && page.tabs.length > 0
                ? { ...page, actions: page.tabs.flatMap((tab) => tab.actions), tabs: [] }
                : page,
            ),
        }))
        .filter((menu) => menu.pages.length > 0),
    }))
    .filter((module) => module.menus.length > 0);

export const filterFunctionCatalogByAudience = (audience: FunctionAudience) =>
  filterCatalogPagesByAudience(fullFunctionCatalog, audience);

export const getRuntimeFunctionCatalog = (audience: FunctionAudience) => filterFunctionCatalogByAudience(audience);

export const terminalFunctionTrees: Record<TerminalType, FunctionModule[]> = {
  store: filterCatalogPagesByAudience(getRuntimeFunctionCatalog('store'), 'store'),
  supplier: filterCatalogPagesByAudience(getRuntimeFunctionCatalog('supplier'), 'supplier'),
  'supply-chain': filterCatalogPagesByAudience(getRuntimeFunctionCatalog('supply-chain'), 'supply-chain'),
};

export const getFunctionModulePermissionValues = (module?: FunctionModule) =>
  Array.from(
    new Set(
      module?.menus.flatMap((menu) =>
        menu.pages.flatMap((page) => [
          ...page.actions.map((action) => action.value),
          ...page.tabs.flatMap((tab) => tab.actions.map((action) => action.value)),
        ]),
      ) ?? [],
    ),
  );

export const getFunctionCatalogPermissionValues = (modules: FunctionModule[]) =>
  Array.from(new Set(modules.flatMap(getFunctionModulePermissionValues)));

export const collectFunctionCatalogRows = (module?: FunctionModule): FunctionCatalogRow[] =>
  module?.menus.flatMap((menu) => {
    const menuRows: Omit<FunctionCatalogRow, 'showMenu' | 'menuRowspan'>[] = menu.pages.flatMap((page) => {
      const actionTabs = page.tabs.filter((tab) => tab.actions.length);
      const rowTabs = actionTabs.length ? actionTabs : page.splitSharedTabs ? page.tabs : [];
      if (rowTabs.length) {
        const globalRows = page.actions.length
          ? [
              {
                key: `${menu.value}.${page.value}.global`,
                tabLabels: ['页面全局'],
                actions: page.actions,
                selectionLabel: '页面全局权限',
              },
            ]
          : [];
        const tabRows = rowTabs.map((tab) => ({
          key: `${menu.value}.${page.value}.${tab.value}`,
          tabLabels: tab.parentLabel ? [tab.parentLabel, tab.label] : [tab.label],
          actions: tab.actions,
          selectionLabel: '当前 Tab 权限',
        }));
        const rows = [...globalRows, ...tabRows];
        return rows.map((row, index) => {
          return {
            ...row,
            menuLabel: menu.label,
            direct: menu.direct,
            thirdMenuLabel: page.thirdMenuLabel,
            showThirdMenu: index === 0,
            thirdMenuRowspan: rows.length,
            pageLabel: page.label,
            pageNote: page.note,
            showPage: index === 0,
            pageRowspan: rows.length,
          };
        });
      }

      return [
        {
          key: `${menu.value}.${page.value}`,
          menuLabel: menu.label,
          direct: menu.direct,
          thirdMenuLabel: page.thirdMenuLabel,
          showThirdMenu: true,
          thirdMenuRowspan: 1,
          pageLabel: page.label,
          pageNote: page.note,
          showPage: true,
          pageRowspan: 1,
          tabLabels: page.tabs.map((tab) => tab.label),
          actions: page.actions,
          selectionLabel: page.tabs.length ? '整页权限（包含全部 Tab）' : '整页权限',
        },
      ];
    });

    return menuRows.map((row, index) => ({
      ...row,
      showMenu: index === 0,
      menuRowspan: menuRows.length,
    }));
  }) ?? [];

const toCanonicalPermission = (permission: string) => {
  if (permission.endsWith('.reset') || permission.endsWith('.重置')) return '';
  if (permission.endsWith('.query') || permission.endsWith('.查询')) {
    return `${permission.slice(0, permission.lastIndexOf('.'))}.view`;
  }
  return permission;
};

export const getRowViewPermissionValue = (row: FunctionCatalogRow) =>
  row.actions.find((action) => isViewPermission(action.value))?.value;

export const normalizeFunctionCatalogPermissions = (modules: FunctionModule[], permissions: string[]) => {
  if (permissions.includes('all')) return ['all'];

  const catalogValues = getFunctionCatalogPermissionValues(modules);
  const allowedValues = new Set(catalogValues);
  const selectedValues = new Set(
    permissions
      .flatMap(expandLegacyScopedPermission)
      .map(toCanonicalPermission)
      .filter((permission) => permission && allowedValues.has(permission)),
  );

  modules.flatMap(collectFunctionCatalogRows).forEach((row) => {
    const viewPermission = getRowViewPermissionValue(row);
    if (
      viewPermission &&
      row.actions.some((action) => !isViewPermission(action.value) && selectedValues.has(action.value))
    ) {
      selectedValues.add(viewPermission);
    }
  });

  return catalogValues.filter((permission) => selectedValues.has(permission));
};

export const normalizeTerminalPermissions = (_terminal: TerminalType, permissions: string[]) =>
  normalizeFunctionCatalogPermissions(terminalFunctionTrees[_terminal], permissions).filter(
    (permission) => permission !== 'all',
  );

export const filterFunctionCatalogByPermissions = (
  modules: FunctionModule[],
  permissions: string[],
): FunctionModule[] => {
  const allowed = new Set(normalizeFunctionCatalogPermissions(modules, permissions));
  return modules
    .map((module) => ({
      ...module,
      menus: module.menus
        .map((menu) => ({
          ...menu,
          pages: menu.pages
            .map((page) => ({
              ...page,
              actions: page.actions.filter((action) => allowed.has(action.value)),
              tabs: page.tabs
                .map((tab) => ({ ...tab, actions: tab.actions.filter((action) => allowed.has(action.value)) }))
                .filter((tab) => tab.actions.length),
            }))
            .filter((page) => page.actions.length || page.tabs.length),
        }))
        .filter((menu) => menu.pages.length),
    }))
    .filter((module) => module.menus.length);
};

export const initialAllocationValues: Record<TerminalType, string[]> = {
  store: [],
  supplier: [],
  'supply-chain': [],
};
