import type { FunctionAction, FunctionModule } from './functionCatalog';

export const supplyChainProducts: FunctionModule = {
  label: '商品管理',
  value: 'supply-chain.products',
  audiences: ['supply-chain'],
  menus: (['finished-stock-management', 'slab-management'] as const).map((key) => {
    const prefix = `supply-chain.${key}`;
    const actions = (tab: string, entries: [string, string][]): FunctionAction[] =>
      entries.map(([value, label]) => ({ label, value: `${prefix}.${tab}.${value}` }));
    return {
      value: `${prefix}.menu`,
      label: key === 'slab-management' ? '大板管理' : '成品现货管理',
      direct: false,
      pages: [
        {
          label: key === 'slab-management' ? '大板管理页' : '成品现货管理页',
          value: prefix,
          audiences: ['supply-chain'],
          actions: [{ label: '操作日志', value: `${prefix}.operation-log.view` }],
          tabs: [
            {
              label: '仓库中',
              value: `${prefix}.warehouse`,
              actions: actions('warehouse', [
                ['publish', '发布商品'],
                ['batch-shelf', '批量上架'],
                ['shelf', '上架'],
                ['edit', '编辑'],
                ['delete', '删除'],
              ]),
            },
            {
              label: '已上架',
              value: `${prefix}.selling`,
              actions: actions('selling', [
                ['publish', '发布商品'],
                ['batch-off-shelf', '批量下架'],
                ['off-shelf', '下架'],
                ['edit', '编辑'],
              ]),
            },
            {
              label: '已下架',
              value: `${prefix}.off-shelf`,
              actions: actions('off-shelf', [
                ['batch-restore', '批量放回到仓库'],
                ['detail', '详情'],
                ['restore', '放回仓库'],
                ['delete', '删除'],
              ]),
            },
            { label: '已售完', value: `${prefix}.sold-out`, actions: actions('sold-out', [['detail', '详情']]) },
            {
              label: '回收站',
              value: `${prefix}.recycle`,
              actions: actions('recycle', [
                ['batch-restore', '批量放回到仓库'],
                ['batch-purge', '批量彻底删除'],
                ['clear', '清空回收站'],
                ['detail', '详情'],
                ['restore', '放回仓库'],
                ['purge', '彻底删除'],
              ]),
            },
          ],
        },
      ],
    };
  }),
};
export const supplyTypeModule: FunctionModule = {
  label: '供应商供货类型管理',
  value: 'admin.supplier-supply-type-management',
  audiences: ['admin'],
  menus: [
    {
      value: 'admin.supplier-supply-type-management.menu',
      direct: true,
      pages: [
        {
          label: '供应商供货类型管理',
          value: 'admin.supplier-supply-type-management',
          tabs: [],
          actions: [
            ['create', '新增'],
            ['edit', '编辑'],
            ['toggle-status', '停用/启用'],
            ['delete', '删除'],
          ].map(([action, label]) => ({ label, value: `admin.supplier-supply-type-management.${action}` })),
        },
      ],
    },
  ],
};
