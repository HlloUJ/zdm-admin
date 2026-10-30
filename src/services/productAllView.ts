import { h } from 'vue';
import './productStateActivity.css';
import type { PrimaryTableCol, TableRowData } from 'tdesign-vue-next';

export type ProductListTab<Status extends string> = Status | 'all';
export const isAllProductStatus = (status: string) => status === 'warehouse' || status === 'selling';
export const productCreationColumns = (toggleTimeSort?: () => void): PrimaryTableCol<TableRowData>[] => [
  { colKey: 'createdByName', title: '创建人', width: 120 },
  {
    colKey: 'createdAt',
    title: toggleTimeSort
      ? () => h('button', { type: 'button', class: 'product-state-time-title', onClick: toggleTimeSort }, '创建时间')
      : '创建时间',
    width: 180,
    className: 'product-state-time-column',
    sorter: true,
  },
];
/** Sort either direction; equal times retain incoming order and missing times stay last. */
export function sortProductsByCreation<T extends { createdAt?: string }>(items: T[], descending = true): T[] {
  const time = (value?: string) => {
    const parsed = value ? Date.parse(value) : Number.NaN;
    return Number.isFinite(parsed) ? parsed : null;
  };
  return [...items].sort((a, b) => {
    const left = time(a.createdAt),
      right = time(b.createdAt);
    if (left === null || right === null) return left === right ? 0 : left === null ? 1 : -1;
    return (descending ? -1 : 1) * (left - right);
  });
}

export function initialProductListTab(value: unknown): 'all' | 'warehouse' | 'selling' | 'soldOut' | 'recycle' {
  return ['all', 'warehouse', 'selling', 'soldOut', 'recycle'].includes(String(value))
    ? (value as 'all' | 'warehouse' | 'selling' | 'soldOut' | 'recycle')
    : 'all';
}

export const productAllViewPages: ReadonlySet<string> = new Set([
  'admin.finished-stock-management',
  'admin.accessory-management',
  'admin.slab-management',
  'supply-chain.finished-stock-management',
  'supply-chain.accessory-management',
  'supply-chain.slab-management',
  'store.finished-stock-management',
  'store.accessory-management',
]);
