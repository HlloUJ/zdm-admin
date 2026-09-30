import type { FunctionAction, FunctionModule } from './functionCatalog';

const productCategoryTabActions = (scope: string): FunctionAction[] => [
  { label: '新增一级分类', value: `${scope}.create-root` },
  { label: '新增下级', value: `${scope}.create-child` },
  { label: '编辑', value: `${scope}.edit` },
  { label: '排序', value: `${scope}.sort` },
  { label: '停用/启用', value: `${scope}.toggle-status` },
  { label: '删除', value: `${scope}.delete` },
];

const productAttributeTabActions = (scope: string): FunctionAction[] => [
  { label: '新增', value: `${scope}.create` },
  { label: '停用/启用', value: `${scope}.toggle-status` },
  { label: '删除', value: `${scope}.delete` },
];

const categoryAttributeTemplateTabActions = (scope: string): FunctionAction[] => [
  { label: '创建新版本草稿', value: `${scope}.create` },
  { label: '版本记录', value: `${scope}.history` },
  { label: '排序', value: `${scope}.sort` },
];

// 全量功能目录只接收已完成业务梳理、实现并验证通过的正式功能资源。
// 终端功能分配和角色管理共同消费此目录，禁止在各页面内维护功能数据副本。
export const verifiedFunctionCatalog: FunctionModule[] = [
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
    audiences: ['store', 'supplier'],
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
                  { label: '批量上架', value: 'admin.slab-management.warehouse.batch-shelf' },
                  { label: '编辑', value: 'admin.slab-management.warehouse.edit' },
                  { label: '上架', value: 'admin.slab-management.warehouse.shelf' },
                  { label: '删除', value: 'admin.slab-management.warehouse.delete' },
                ],
              },
              {
                label: '已上架',
                value: 'admin.slab-management.selling',
                actions: [
                  { label: '批量下架', value: 'admin.slab-management.selling.batch-off-shelf' },
                  { label: '编辑', value: 'admin.slab-management.selling.edit' },
                  { label: '下架', value: 'admin.slab-management.selling.off-shelf' },
                ],
              },
              {
                label: '已下架',
                value: 'admin.slab-management.off-shelf',
                actions: [
                  { label: '批量放回到仓库', value: 'admin.slab-management.off-shelf.batch-restore' },
                  { label: '详情', value: 'admin.slab-management.off-shelf.detail' },
                  { label: '放回仓库', value: 'admin.slab-management.off-shelf.restore' },
                  { label: '删除', value: 'admin.slab-management.off-shelf.delete' },
                ],
              },
              {
                label: '已售完',
                value: 'admin.slab-management.sold-out',
                actions: [{ label: '详情', value: 'admin.slab-management.sold-out.detail' }],
              },
              {
                label: '回收站',
                value: 'admin.slab-management.recycle',
                actions: [
                  { label: '批量放回到仓库', value: 'admin.slab-management.recycle.batch-restore' },
                  { label: '批量彻底删除', value: 'admin.slab-management.recycle.batch-purge' },
                  { label: '清空回收站', value: 'admin.slab-management.recycle.clear' },
                  { label: '详情', value: 'admin.slab-management.recycle.detail' },
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
            tabs: ['finished', 'accessory'].map((scope) => ({
              label: scope === 'finished' ? '成品现货模板' : '配件模板',
              value: `admin.product-data-center.category-attribute-template.${scope}.attributes`,
              actions: categoryAttributeTemplateTabActions(
                `admin.product-data-center.category-attribute-template.${scope}.attributes`,
              ),
            })),
          },
        ],
      },
      {
        label: '价格配置',
        value: 'admin.product-data-center.markup-configuration.menu',
        direct: false,
        pages: [
          {
            label: '价格配置页',
            value: 'admin.product-data-center.markup-configuration',
            audiences: ['admin'],
            actions: [],
            tabs: [
              {
                label: '成品价格配置',
                value: 'admin.product-data-center.markup-configuration.finished',
                actions: [
                  {
                    label: '保存指导价',
                    value: 'admin.product-data-center.markup-configuration.finished.guide-price.edit',
                  },
                  { label: '新增', value: 'admin.product-data-center.markup-configuration.finished.create' },
                  { label: '编辑', value: 'admin.product-data-center.markup-configuration.finished.edit' },
                  {
                    label: '停用/启用',
                    value: 'admin.product-data-center.markup-configuration.finished.toggle-status',
                  },
                  { label: '排序', value: 'admin.product-data-center.markup-configuration.finished.sort' },
                  { label: '删除', value: 'admin.product-data-center.markup-configuration.finished.delete' },
                ],
              },
              {
                label: '大板价格配置',
                value: 'admin.product-data-center.markup-configuration.slab',
                actions: [
                  {
                    label: '保存指导价',
                    value: 'admin.product-data-center.markup-configuration.slab.guide-price.edit',
                  },
                  { label: '新增', value: 'admin.product-data-center.markup-configuration.slab.create' },
                  { label: '编辑', value: 'admin.product-data-center.markup-configuration.slab.edit' },
                  {
                    label: '停用/启用',
                    value: 'admin.product-data-center.markup-configuration.slab.toggle-status',
                  },
                  { label: '排序', value: 'admin.product-data-center.markup-configuration.slab.sort' },
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
              { label: '排序', value: 'admin.product-data-center.slab-grade.sort' },
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
      {
        label: '终端功能分配',
        value: 'admin.permission-management.terminal-function-allocation.menu',
        direct: false,
        pages: [
          {
            label: '终端功能分配页',
            value: 'admin.permission-management.terminal-function-allocation',
            audiences: ['admin'],
            actions: [{ label: '保存', value: 'admin.permission-management.terminal-function-allocation.save' }],
            tabs: [],
          },
        ],
      },
    ],
  },
];
