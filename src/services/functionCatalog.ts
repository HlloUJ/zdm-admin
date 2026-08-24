import { expandLegacyScopedPermission } from './functionPermissionCompatibility';

export type TerminalType = 'store' | 'supplier';
export type FunctionAudience = 'admin' | TerminalType;

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
  { label: '停用/启用', value: `${scope}.toggle-status` },
  { label: '删除', value: `${scope}.delete` },
];

const productAttributeTabActions = (scope: string): FunctionAction[] => [
  { label: '新增', value: `${scope}.create` },
  { label: '停用/启用', value: `${scope}.toggle-status` },
  { label: '删除', value: `${scope}.delete` },
];

const categoryAttributeTemplateTabActions = (scope: string): FunctionAction[] => [
  { label: '绑定属性', value: `${scope}.create` },
  { label: '属性角色', value: `${scope}.attribute-role` },
  { label: '参与SKU组合', value: `${scope}.sku-combination` },
  { label: '必填', value: `${scope}.required` },
  { label: '绑定选项值', value: `${scope}.bind-values` },
  { label: '发布/取消发布', value: `${scope}.toggle-publish` },
  { label: '移除', value: `${scope}.delete` },
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
    label: '供应商管理',
    value: 'admin.supplier-management',
    menus: [
      {
        value: 'admin.supplier-management.menu',
        direct: true,
        pages: [
          {
            label: '供应商管理页',
            value: 'admin.supplier-management',
            actions: [
              { label: '新增', value: 'admin.supplier-management.create' },
              { label: '供货类型配置', value: 'admin.supplier-management.manage-supply-types' },
              { label: '编辑', value: 'admin.supplier-management.edit' },
              { label: '停用/启用', value: 'admin.supplier-management.toggle-status' },
              { label: '删除', value: 'admin.supplier-management.delete' },
            ],
            tabs: [],
          },
        ],
      },
    ],
  },
  {
    label: '门店分类管理',
    value: 'admin.tenant.store-category-management',
    audiences: ['store'],
    menus: [
      {
        value: 'admin.tenant.store-category-management.menu',
        direct: true,
        pages: [
          {
            label: '门店分类管理页',
            value: 'admin.tenant.store-category-management',
            actions: [
              { label: '新增一级分类', value: 'admin.tenant.store-category-management.create-root' },
              { label: '新增下级', value: 'admin.tenant.store-category-management.create-child' },
              { label: '编辑', value: 'admin.tenant.store-category-management.edit' },
              { label: '上移', value: 'admin.tenant.store-category-management.move-up' },
              { label: '下移', value: 'admin.tenant.store-category-management.move-down' },
              { label: '停用/启用', value: 'admin.tenant.store-category-management.toggle-status' },
              { label: '删除', value: 'admin.tenant.store-category-management.delete' },
            ],
            tabs: [],
          },
        ],
      },
    ],
  },
  {
    label: '商品管理',
    value: 'admin.product-data-center',
    menus: [
      {
        label: '大板管理',
        value: 'admin.slab-management.menu',
        direct: false,
        pages: [
          {
            label: '大板管理页',
            value: 'admin.slab-management',
            audiences: ['admin'],
            actions: [{ label: '操作日志', value: 'admin.slab-management.operation-log.view' }],
            tabs: [
              {
                label: '仓库中',
                value: 'admin.slab-management.warehouse',
                actions: [
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
                  { label: '批量放回仓库', value: 'admin.slab-management.off-shelf.batch-restore' },
                  { label: '详情', value: 'admin.slab-management.off-shelf.detail' },
                  { label: '放回仓库', value: 'admin.slab-management.off-shelf.restore' },
                  { label: '删除', value: 'admin.slab-management.off-shelf.delete' },
                ],
              },
              {
                label: '已售完',
                value: 'admin.slab-management.sold-out',
                actions: [{ label: '价格', value: 'admin.slab-management.sold-out.price' }],
              },
              {
                label: '回收站',
                value: 'admin.slab-management.recycle',
                actions: [
                  { label: '批量放回仓库', value: 'admin.slab-management.recycle.batch-restore' },
                  { label: '批量彻底删除', value: 'admin.slab-management.recycle.batch-purge' },
                  { label: '清空回收站', value: 'admin.slab-management.recycle.clear' },
                  { label: '价格', value: 'admin.slab-management.recycle.price' },
                  { label: '放回仓库', value: 'admin.slab-management.recycle.restore' },
                  { label: '彻底删除', value: 'admin.slab-management.recycle.purge' },
                ],
              },
            ],
          },
        ],
      },
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
            actions: [],
            tabs: [
              {
                label: '共享基础属性',
                value: 'admin.product-data-center.attribute.shared',
                actions: productAttributeTabActions('admin.product-data-center.attribute.shared'),
              },
              {
                label: '成品现货专属属性',
                value: 'admin.product-data-center.attribute.finished',
                actions: productAttributeTabActions('admin.product-data-center.attribute.finished'),
              },
              {
                label: '配件专属属性',
                value: 'admin.product-data-center.attribute.accessory',
                actions: productAttributeTabActions('admin.product-data-center.attribute.accessory'),
              },
            ],
          },
        ],
      },
      {
        label: '属性值管理',
        value: 'admin.product-data-center.attribute-value.menu',
        direct: false,
        pages: [
          {
            label: '属性值管理页',
            value: 'admin.product-data-center.attribute-value',
            actions: [],
            tabs: [
              {
                label: '共享基础属性值',
                value: 'admin.product-data-center.attribute-value.shared',
                actions: productAttributeTabActions('admin.product-data-center.attribute-value.shared'),
              },
              {
                label: '成品现货专属值',
                value: 'admin.product-data-center.attribute-value.finished',
                actions: productAttributeTabActions('admin.product-data-center.attribute-value.finished'),
              },
              {
                label: '配件专属值',
                value: 'admin.product-data-center.attribute-value.accessory',
                actions: productAttributeTabActions('admin.product-data-center.attribute-value.accessory'),
              },
            ],
          },
        ],
      },
      {
        label: '分类属性模板',
        value: 'admin.product-data-center.category-attribute-template.menu',
        direct: false,
        pages: [
          {
            label: '分类属性模板页',
            value: 'admin.product-data-center.category-attribute-template',
            actions: [],
            tabs: [
              {
                label: '成品现货模板',
                value: 'admin.product-data-center.category-attribute-template.finished',
                actions: categoryAttributeTemplateTabActions(
                  'admin.product-data-center.category-attribute-template.finished',
                ),
              },
              {
                label: '配件模板',
                value: 'admin.product-data-center.category-attribute-template.accessory',
                actions: categoryAttributeTemplateTabActions(
                  'admin.product-data-center.category-attribute-template.accessory',
                ),
              },
            ],
          },
        ],
      },
      {
        label: '加价配置',
        value: 'admin.product-data-center.markup-configuration.menu',
        direct: false,
        pages: [
          {
            label: '加价配置页',
            value: 'admin.product-data-center.markup-configuration',
            audiences: ['admin'],
            actions: [],
            tabs: [
              {
                label: '成品加价配置',
                value: 'admin.product-data-center.markup-configuration.finished',
                actions: [
                  { label: '新增', value: 'admin.product-data-center.markup-configuration.finished.create' },
                  { label: '编辑', value: 'admin.product-data-center.markup-configuration.finished.edit' },
                  { label: '排序', value: 'admin.product-data-center.markup-configuration.finished.sort' },
                  {
                    label: '停用/启用',
                    value: 'admin.product-data-center.markup-configuration.finished.toggle-status',
                  },
                  { label: '删除', value: 'admin.product-data-center.markup-configuration.finished.delete' },
                ],
              },
              {
                label: '大板加价配置',
                value: 'admin.product-data-center.markup-configuration.slab',
                actions: [
                  { label: '新增', value: 'admin.product-data-center.markup-configuration.slab.create' },
                  { label: '编辑', value: 'admin.product-data-center.markup-configuration.slab.edit' },
                  { label: '排序', value: 'admin.product-data-center.markup-configuration.slab.sort' },
                  {
                    label: '停用/启用',
                    value: 'admin.product-data-center.markup-configuration.slab.toggle-status',
                  },
                  { label: '删除', value: 'admin.product-data-center.markup-configuration.slab.delete' },
                ],
              },
            ],
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
      {
        label: '大板基础数据',
        value: 'admin.product-data-center.slab-base-data.menu',
        direct: false,
        pages: [
          {
            label: '品种管理页',
            value: 'admin.product-data-center.slab-variety',
            thirdMenuLabel: '品种管理',
            actions: [
              { label: '新增', value: 'admin.product-data-center.slab-variety.create' },
              { label: '编辑', value: 'admin.product-data-center.slab-variety.edit' },
              { label: '停用/启用', value: 'admin.product-data-center.slab-variety.toggle-status' },
              { label: '删除', value: 'admin.product-data-center.slab-variety.delete' },
            ],
            tabs: [],
          },
          {
            label: '产地管理页',
            value: 'admin.product-data-center.slab-origin',
            thirdMenuLabel: '产地管理',
            actions: [
              { label: '新增', value: 'admin.product-data-center.slab-origin.create' },
              { label: '编辑', value: 'admin.product-data-center.slab-origin.edit' },
              { label: '停用/启用', value: 'admin.product-data-center.slab-origin.toggle-status' },
              { label: '删除', value: 'admin.product-data-center.slab-origin.delete' },
            ],
            tabs: [],
          },
          {
            label: '纹理管理页',
            value: 'admin.product-data-center.slab-texture',
            thirdMenuLabel: '纹理管理',
            actions: [
              { label: '新增', value: 'admin.product-data-center.slab-texture.create' },
              { label: '别名', value: 'admin.product-data-center.slab-texture.manage-aliases' },
              { label: '编辑', value: 'admin.product-data-center.slab-texture.edit' },
              { label: '停用/启用', value: 'admin.product-data-center.slab-texture.toggle-status' },
              { label: '删除', value: 'admin.product-data-center.slab-texture.delete' },
            ],
            tabs: [],
          },
          {
            label: '色系管理页',
            value: 'admin.product-data-center.slab-color',
            thirdMenuLabel: '色系管理',
            actions: [
              { label: '新增', value: 'admin.product-data-center.slab-color.create' },
              { label: '色系分类管理', value: 'admin.product-data-center.slab-color.manage-categories' },
              { label: '编辑', value: 'admin.product-data-center.slab-color.edit' },
              { label: '停用/启用', value: 'admin.product-data-center.slab-color.toggle-status' },
              { label: '删除', value: 'admin.product-data-center.slab-color.delete' },
            ],
            tabs: [],
          },
          {
            label: '等级管理页',
            value: 'admin.product-data-center.slab-grade',
            thirdMenuLabel: '等级管理',
            actions: [
              { label: '新增', value: 'admin.product-data-center.slab-grade.create' },
              { label: '编辑', value: 'admin.product-data-center.slab-grade.edit' },
              { label: '停用/启用', value: 'admin.product-data-center.slab-grade.toggle-status' },
              { label: '删除', value: 'admin.product-data-center.slab-grade.delete' },
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
    audiences: ['admin', 'store', 'supplier'],
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
            actions: [
              { label: '新增', value: 'admin.permission-management.role-management.create' },
              { label: '编辑', value: 'admin.permission-management.role-management.edit' },
              { label: '权限', value: 'admin.permission-management.role-management.permission' },
              { label: '删除', value: 'admin.permission-management.role-management.delete' },
            ],
            tabs: [],
          },
        ],
      },
    ],
  },
];

const storeLevelModule: FunctionModule = {
  label: '租户与门店',
  value: 'admin.tenant',
  audiences: ['admin'],
  menus: [
    {
      label: '租户管理',
      value: 'admin.tenant.tenant-management.menu',
      direct: false,
      pages: [
        {
          label: '租户管理页',
          value: 'admin.tenant.tenant-management',
          actions: [],
          tabs: [
            {
              label: '运营中',
              value: 'admin.tenant.tenant-management.unarchived',
              actions: [
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
                { label: '恢复运营', value: 'admin.tenant.tenant-management.archived.restore' },
                { label: '彻底删除', value: 'admin.tenant.tenant-management.archived.delete' },
              ],
            },
          ],
        },
      ],
    },
    {
      label: '门店管理',
      value: 'admin.tenant.tenant-store-management.menu',
      direct: false,
      pages: [
        {
          label: '门店管理页',
          value: 'admin.tenant.tenant-store-management',
          actions: [],
          tabs: [
            {
              label: '运营中',
              value: 'admin.tenant.tenant-store-management.operating',
              actions: [
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
                { label: '恢复运营', value: 'admin.tenant.tenant-store-management.archived.restore' },
                { label: '彻底删除', value: 'admin.tenant.tenant-store-management.archived.delete' },
              ],
            },
          ],
        },
      ],
    },
    {
      label: '门店基础数据',
      value: 'admin.tenant.store-base-data.menu',
      direct: false,
      pages: [
        {
          label: '门店级别管理页',
          value: 'admin.tenant.store-level-management',
          thirdMenuLabel: '门店级别管理',
          actions: [
            { label: '新增', value: 'admin.tenant.store-level-management.create' },
            { label: '编辑', value: 'admin.tenant.store-level-management.edit' },
            { label: '停用/启用', value: 'admin.tenant.store-level-management.toggle-status' },
            { label: '删除', value: 'admin.tenant.store-level-management.delete' },
          ],
          tabs: [],
        },
      ],
    },
  ],
};

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
  'admin.product-data-center',
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

export const fullFunctionCatalog = applyConfirmedNavigationStructure(
  orderModulesByNavigation(withDefaultViewPermissions([storeLevelModule, ...verifiedFunctionCatalog])),
);

const filterCatalogPagesByAudience = (modules: FunctionModule[], audience: FunctionAudience) =>
  modules
    .map((module) => ({
      ...module,
      menus: module.menus
        .map((menu) => ({
          ...menu,
          pages: menu.pages.filter((page) => !page.audiences || page.audiences.includes(audience)),
        }))
        .filter((menu) => menu.pages.length > 0),
    }))
    .filter((module) => module.menus.length > 0);

export const filterFunctionCatalogByAudience = (audience: FunctionAudience) =>
  filterCatalogPagesByAudience(
    fullFunctionCatalog.filter((module) => !module.audiences || module.audiences.includes(audience)),
    audience,
  );

export const getRuntimeFunctionCatalog = (audience: FunctionAudience) =>
  import.meta.env.PROD ? filterFunctionCatalogByAudience(audience) : fullFunctionCatalog;

export const terminalFunctionTrees: Record<TerminalType, FunctionModule[]> = {
  store: filterCatalogPagesByAudience(getRuntimeFunctionCatalog('store'), 'store'),
  supplier: filterCatalogPagesByAudience(getRuntimeFunctionCatalog('supplier'), 'supplier'),
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
          tabLabels: [tab.label],
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
};
