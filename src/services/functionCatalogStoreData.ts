import type { FunctionModule } from './functionCatalog';

export const storeLevelModule: FunctionModule = {
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
            { label: '排序', value: 'admin.tenant.store-level-management.sort' },
            { label: '停用/启用', value: 'admin.tenant.store-level-management.toggle-status' },
            { label: '删除', value: 'admin.tenant.store-level-management.delete' },
          ],
          tabs: [],
        },
      ],
    },
  ],
};

export const storeFinishedStock: FunctionModule = {
  label: '成品现货管理',
  value: 'store.finished-stock-management',
  audiences: ['store'],
  menus: [
    {
      label: '成品现货管理',
      value: 'store.finished-stock-management.menu',
      direct: true,
      pages: [
        {
          label: '成品现货管理页',
          value: 'store.finished-stock-management',
          actions: [{ label: '操作日志', value: 'store.finished-stock-management.operation-log.view' }],
          tabs: [
            {
              label: '仓库中',
              value: 'store.finished-stock-management.warehouse',
              actions: [
                ['select', '挑选商品'],
                ['batch-shelf', '批量上架'],
                ['edit', '编辑'],
                ['shelf', '上架'],
                ['delete', '删除'],
              ].map(([code, label]) => ({ label, value: `store.finished-stock-management.warehouse.${code}` })),
            },
            {
              label: '出售中',
              value: 'store.finished-stock-management.selling',
              actions: [
                ['batch-off-shelf', '批量下架'],
                ['edit', '编辑'],
                ['off-shelf', '下架'],
              ].map(([code, label]) => ({ label, value: `store.finished-stock-management.selling.${code}` })),
            },
            {
              label: '已下架',
              value: 'store.finished-stock-management.off-shelf',
              actions: [
                ['batch-restore', '批量放回到仓库'],
                ['detail', '详情'],
                ['restore', '放回仓库'],
                ['delete', '删除'],
              ].map(([code, label]) => ({ label, value: `store.finished-stock-management.off-shelf.${code}` })),
            },
            {
              label: '已售完',
              value: 'store.finished-stock-management.sold-out',
              actions: [['detail', '详情']].map(([code, label]) => ({
                label,
                value: `store.finished-stock-management.sold-out.${code}`,
              })),
            },
            {
              label: '回收站',
              value: 'store.finished-stock-management.recycle',
              actions: [
                ['batch-restore', '批量放回到仓库'],
                ['batch-purge', '批量彻底删除'],
                ['clear', '清空回收站'],
                ['detail', '详情'],
                ['restore', '放回仓库'],
                ['purge', '彻底删除'],
              ].map(([code, label]) => ({ label, value: `store.finished-stock-management.recycle.${code}` })),
            },
          ],
        },
      ],
    },
  ],
};

export const storePriceConfiguration: FunctionModule = {
  label: '价格配置',
  value: 'store.price-configuration',
  audiences: ['store'],
  menus: [
    {
      label: '价格配置',
      value: 'store.price-configuration.menu',
      direct: true,
      pages: [
        {
          label: '价格配置页',
          value: 'store.price-configuration',
          actions: [],
          tabs: (['price', 'discount'] as const).flatMap((kind) =>
            (['finished', 'accessory'] as const).map((scope) => ({
              parentLabel: kind === 'price' ? '价格系数' : '折扣系数',
              label: scope === 'finished' ? '成品现货' : '配件',
              value: `store.price-configuration.${kind}.${scope}`,
              actions: [{ label: '批量设置', value: `store.price-configuration.${kind}.${scope}.batch-set` }],
            })),
          ),
        },
      ],
    },
  ],
};
