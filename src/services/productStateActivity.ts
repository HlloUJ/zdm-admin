import type { PrimaryTableCol, TableRowData } from 'tdesign-vue-next';

const labels: Record<string, [string, string]> = {
  warehouse: ['入库人', '入库时间'],
  selling: ['上架人', '上架时间'],
  offShelf: ['下架人', '下架时间'],
  soldOut: ['', '售完时间'],
  recycle: ['移入人', '移入时间'],
};
export function stateActivityColumns(status: string): PrimaryTableCol<TableRowData>[] {
  const [actor, time] = labels[status];
  return [
    ...(actor ? [{ colKey: 'stateOperatorName', title: actor, width: 120, align: 'center' as const }] : []),
    { colKey: 'stateOperatedAt', title: time, width: 180, align: 'center' },
  ];
}
export function stateSourceLabel(source: string | undefined, business: string) {
  if (!source || source === business || source === 'system') return '';
  return (
    ({ 'supply-chain': '供应链', admin: '运营', store: '门店', 'external-api': '外部系统' } as Record<string, string>)[
      source
    ] || ''
  );
}
interface ActivityRecord {
  id: number;
  stateOperatedAt?: string;
  createdAt?: string;
}
const timestamp = (value?: string) => {
  const number = value ? Date.parse(value) : 0;
  return Number.isFinite(number) ? number : 0;
};
export function sortByStateActivity<T extends ActivityRecord>(records: T[]): T[] {
  return [...records].sort(
    (a, b) => timestamp(b.stateOperatedAt || b.createdAt) - timestamp(a.stateOperatedAt || a.createdAt) || b.id - a.id,
  );
}
