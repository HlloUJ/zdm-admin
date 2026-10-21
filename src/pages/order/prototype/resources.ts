import type { FunctionModule } from '@/services/functionCatalog';
import { statuses } from './model';
export const prefix = 'store.order-management';
export const salesActions = [
  ['create', '新增订单'],
  ['detail', '查看详情'],
  ['edit', '编辑订单'],
  ['confirm', '确认订单'],
  ['copy', '复制开单'],
  ['receipt', '登记收款'],
  ['refund', '登记退款'],
  ['correct-payment', '更正收退款'],
  ['void-payment', '作废收退款'],
  ['plan', '安排本店发货'],
  ['supply', '向供应链下单'],
  ['cancel', '取消商品并结算'],
  ['terms', '调整运费、交期或负责人'],
  ['revoke-plan', '撤销发货安排'],
  ['correct-shipment', '更正发货记录'],
] as const;
export type SalesAction = (typeof salesActions)[number][0];
export const taskActions = [
  ['ship', '登记客户发货'],
  ['receive', '登记到店收货'],
] as const;
export const settingTabs = [
  { value: 'nature', label: '款项性质' },
  { value: 'method', label: '收退款方式' },
];
const statusActions = (status: string) =>
  salesActions.filter(([a]) => {
    if (['create', 'detail', 'copy', 'refund', 'correct-payment', 'void-payment'].includes(a)) return true;
    if (a === 'receipt') return status !== 'cancelled';
    if (a === 'edit' || a === 'confirm') return status === 'pending';
    if (a === 'cancel' || a === 'terms') return !['completed', 'cancelled'].includes(status);
    if (a === 'correct-shipment') return ['shipped', 'completed'].includes(status);
    return ['confirmed', 'shipped'].includes(status);
  });
export const storeOrderPrototype: FunctionModule = {
  label: '订单管理',
  value: prefix,
  audiences: ['store'],
  menus: [
    {
      label: '销售订单',
      value: `${prefix}.sales.menu`,
      direct: false,
      pages: [
        {
          label: '销售订单页',
          value: `${prefix}.sales`,
          note: '前端原型，仅浏览器模拟数据；未接业务接口和后端权限',
          actions: [],
          tabs: statuses.map((s) => ({
            label: s.label,
            value: `${prefix}.sales.${s.value}`,
            actions: statusActions(s.value).map(([value, label]) => ({
              label,
              value: `${prefix}.sales.${s.value}.${value}`,
            })),
          })),
        },
      ],
    },
    {
      label: '履约任务',
      value: `${prefix}.fulfillment.menu`,
      direct: false,
      pages: [
        {
          label: '履约任务页',
          value: `${prefix}.fulfillment`,
          note: '本店执行任务原型；不模拟供应链真实写入',
          actions: [...taskActions.map(([value, label]) => ({ label, value: `${prefix}.fulfillment.${value}` }))],
          tabs: [],
        },
      ],
    },
    {
      label: '订单配置',
      value: `${prefix}.settings.menu`,
      direct: false,
      pages: [
        {
          label: '订单配置页',
          value: `${prefix}.settings`,
          note: '本地原型配置，不写入真实门店配置',
          actions: [],
          tabs: settingTabs.map((t) => ({
            label: t.label,
            value: `${prefix}.settings.${t.value}`,
            actions: [
              ['create', '新增'],
              ['toggle-status', '停用/启用'],
            ].map(([value, label]) => ({ label: label!, value: `${prefix}.settings.${t.value}.${value}` })),
          })),
        },
      ],
    },
  ],
};
