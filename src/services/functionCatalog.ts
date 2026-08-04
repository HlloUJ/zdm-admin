export type TerminalType = 'store' | 'supplier';

export interface FunctionAction {
  label: string;
  value: string;
}

export interface FunctionTab {
  label: string;
  value: string;
  actions: FunctionAction[];
}

export interface FunctionPage {
  label: string;
  value: string;
  actions: FunctionAction[];
  tabs: FunctionTab[];
  note?: string;
  splitSharedTabs?: boolean;
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
  menus: FunctionMenu[];
}

export interface FunctionCatalogRow {
  key: string;
  menuLabel?: string;
  direct: boolean;
  showMenu: boolean;
  menuRowspan: number;
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

const productCategoryTabActions = (scope: string): FunctionAction[] => [
  { label: '新增一级分类', value: `${scope}.create-root` },
  { label: '新增下级', value: `${scope}.create-child` },
  { label: '编辑', value: `${scope}.edit` },
  { label: '上移', value: `${scope}.move-up` },
  { label: '下移', value: `${scope}.move-down` },
  { label: '停用', value: `${scope}.disable` },
  { label: '启用', value: `${scope}.enable` },
  { label: '删除', value: `${scope}.delete` },
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

// 全量功能目录只接收已完成业务梳理、实现并验证通过的正式功能资源。
// 终端功能分配和角色管理共同消费此目录，禁止在各页面内维护功能数据副本。
const verifiedFunctionCatalog: FunctionModule[] = [
  {
    label: '商品基础数据中心',
    value: 'admin.product-data-center',
    menus: [
      {
        label: '商品分类管理',
        value: 'admin.product-data-center.category.menu',
        direct: false,
        pages: [
          {
            label: '商品分类管理页',
            value: 'admin.product-data-center.category',
            actions: [],
            tabs: [
              {
                label: '成品现货分类',
                value: 'admin.product-data-center.category.finished',
                actions: productCategoryTabActions('admin.product-data-center.category.finished'),
              },
              {
                label: '配件分类',
                value: 'admin.product-data-center.category.accessory',
                actions: productCategoryTabActions('admin.product-data-center.category.accessory'),
              },
            ],
          },
        ],
      },
      {
        label: '属性库管理',
        value: 'admin.product-data-center.attribute.menu',
        direct: false,
        pages: [
          {
            label: '属性库管理页',
            value: 'admin.product-data-center.attribute',
            actions: [
              { label: '新增', value: 'admin.product-data-center.attribute.create' },
              { label: '停用/启用', value: 'admin.product-data-center.attribute.toggle-status' },
              { label: '删除', value: 'admin.product-data-center.attribute.delete' },
            ],
            tabs: [],
          },
        ],
      },
      {
        label: '大板品种管理',
        value: 'admin.product-data-center.slab-variety.menu',
        direct: false,
        pages: [
          {
            label: '大板品种管理页',
            value: 'admin.product-data-center.slab-variety',
            actions: [
              { label: '新增', value: 'admin.product-data-center.slab-variety.create' },
              { label: '编辑', value: 'admin.product-data-center.slab-variety.edit' },
              { label: '停用/启用', value: 'admin.product-data-center.slab-variety.toggle-status' },
              { label: '删除', value: 'admin.product-data-center.slab-variety.delete' },
            ],
            tabs: [],
          },
        ],
      },
      {
        label: '成品现货工艺管理',
        value: 'admin.product-data-center.finished-stock-craft.menu',
        direct: false,
        pages: [
          {
            label: '成品现货工艺管理页',
            value: 'admin.product-data-center.finished-stock-craft',
            actions: [
              { label: '新增', value: 'admin.product-data-center.finished-stock-craft.create' },
              { label: '编辑', value: 'admin.product-data-center.finished-stock-craft.edit' },
              { label: '停用/启用', value: 'admin.product-data-center.finished-stock-craft.toggle-status' },
              { label: '删除', value: 'admin.product-data-center.finished-stock-craft.delete' },
            ],
            tabs: [],
          },
        ],
      },
    ],
  },
  {
    label: '权限管理',
    value: 'admin.permission-management',
    menus: [
      {
        label: '员工管理',
        value: 'admin.permission-management.employee-management.menu',
        direct: false,
        pages: [
          {
            label: '员工管理页',
            value: 'admin.permission-management.employee-management',
            actions: [
              { label: '邀请员工', value: 'admin.permission-management.employee-management.create' },
              { label: '编辑', value: 'admin.permission-management.employee-management.edit' },
              { label: '角色', value: 'admin.permission-management.employee-management.permission' },
              { label: '停用/启用', value: 'admin.permission-management.employee-management.toggle-status' },
              { label: '删除', value: 'admin.permission-management.employee-management.delete' },
            ],
            tabs: [],
          },
        ],
      },
      {
        label: '角色管理',
        value: 'admin.permission-management.role-management.menu',
        direct: false,
        pages: [
          {
            label: '角色管理页',
            value: 'admin.permission-management.role-management',
            actions: [],
            tabs: [
              {
                label: '运营管理平台角色',
                value: 'admin.permission-management.role-management.operation-platform',
                actions: [
                  {
                    label: '新增',
                    value: 'admin.permission-management.role-management.operation-platform.create',
                  },
                  {
                    label: '编辑',
                    value: 'admin.permission-management.role-management.operation-platform.edit',
                  },
                  {
                    label: '权限',
                    value: 'admin.permission-management.role-management.operation-platform.permission',
                  },
                  {
                    label: '删除',
                    value: 'admin.permission-management.role-management.operation-platform.delete',
                  },
                ],
              },
              {
                label: '城市合伙人门店角色',
                value: 'admin.permission-management.role-management.partner-store',
                actions: [
                  {
                    label: '新增',
                    value: 'admin.permission-management.role-management.partner-store.create',
                  },
                  {
                    label: '编辑',
                    value: 'admin.permission-management.role-management.partner-store.edit',
                  },
                  {
                    label: '删除',
                    value: 'admin.permission-management.role-management.partner-store.delete',
                  },
                ],
              },
              {
                label: '大板供应商门店角色',
                value: 'admin.permission-management.role-management.supplier-store',
                actions: [
                  {
                    label: '新增',
                    value: 'admin.permission-management.role-management.supplier-store.create',
                  },
                  {
                    label: '编辑',
                    value: 'admin.permission-management.role-management.supplier-store.edit',
                  },
                  {
                    label: '删除',
                    value: 'admin.permission-management.role-management.supplier-store.delete',
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  },
];

export const fullFunctionCatalog = withDefaultViewPermissions(verifiedFunctionCatalog);

export const terminalFunctionTrees: Record<TerminalType, FunctionModule[]> = {
  store: fullFunctionCatalog,
  supplier: fullFunctionCatalog,
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
        return rowTabs.map((tab, index) => {
          const actions = Array.from(
            new Map([...tab.actions, ...page.actions].map((action) => [action.value, action])).values(),
          );
          return {
            key: `${menu.value}.${page.value}.${tab.value}`,
            menuLabel: menu.label,
            direct: menu.direct,
            pageLabel: page.label,
            pageNote: page.note,
            showPage: index === 0,
            pageRowspan: rowTabs.length,
            tabLabels: [tab.label],
            actions,
            selectionLabel: '当前 Tab 权限',
          };
        });
      }

      return [
        {
          key: `${menu.value}.${page.value}`,
          menuLabel: menu.label,
          direct: menu.direct,
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
    permissions.map(toCanonicalPermission).filter((permission) => permission && allowedValues.has(permission)),
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
  normalizeFunctionCatalogPermissions(fullFunctionCatalog, permissions).filter((permission) => permission !== 'all');

export const initialAllocationValues: Record<TerminalType, string[]> = {
  store: [],
  supplier: [],
};
