import { Button } from 'tdesign-vue-next';
import type { PrimaryTableCol, TableRowData } from 'tdesign-vue-next';

const labels: Record<string, [string, string]> = {
  warehouse: ['入库人', '入库时间'],
  selling: ['上架人', '上架时间'],
  soldOut: ['', '售完时间'],
  recycle: ['移入人', '移入时间'],
};
export function stateActivityColumns(status: string, toggleTimeSort?: () => void): PrimaryTableCol<TableRowData>[] {
  const [actor, time] = labels[status];
  return [
    ...(actor ? [{ colKey: 'stateOperatorName', title: actor, width: 120, align: 'center' as const }] : []),
    {
      colKey: 'stateOperatedAt',
      title: toggleTimeSort
        ? (h) => h(Button, { variant: 'text', theme: 'default', size: 'small', onClick: toggleTimeSort }, () => time)
        : time,
      width: 180,
      align: 'center',
      sorter: true,
    },
  ];
}
interface ActivityRecord {
  id: number;
  stateOperatedAt?: string;
  createdAt?: string;
}
const timestamp = (value?: string) => {
  const number = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(number) ? number : null;
};
export function sortByStateActivity<T extends ActivityRecord>(records: T[], descending = true): T[] {
  const direction = descending ? -1 : 1;
  return [...records].sort((a, b) => {
    const left = timestamp(a.stateOperatedAt);
    const right = timestamp(b.stateOperatedAt);
    if (left === null || right === null) return left !== null ? -1 : right !== null ? 1 : direction * (a.id - b.id);
    return direction * (left - right || a.id - b.id);
  });
}
