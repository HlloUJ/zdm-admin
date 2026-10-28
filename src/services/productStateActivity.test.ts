import { describe, expect, it } from 'vitest';
import { sortByStateActivity, stateActivityColumns } from './productStateActivity';

describe('product state activity', () => {
  it('puts recently transitioned old products ahead of newly created products without mutating input', () => {
    const records = [
      { id: 2, createdAt: '2026-10-10 12:00:00', stateOperatedAt: '2026-10-10 12:00:00' },
      { id: 1, createdAt: '2020-01-01 12:00:00', stateOperatedAt: '2026-10-12 12:00:00' },
    ];
    expect(sortByStateActivity(records).map((row) => row.id)).toEqual([1, 2]);
    expect(records.map((row) => row.id)).toEqual([2, 1]);
  });
  it('uses creation only for unknown history and stabilizes equal state times', () => {
    expect(sortByStateActivity([{ id: 1 }, { id: 2 }]).map((row) => row.id)).toEqual([2, 1]);
    expect(
      sortByStateActivity([
        { id: 1, createdAt: '2026-10-12' },
        { id: 2, stateOperatedAt: '2026-10-11' },
      ]).map((row) => row.id),
    ).toEqual([1, 2]);
  });
  it('shows only sold-out time and no creation columns in any state', () => {
    expect(stateActivityColumns('soldOut').map((column) => column.title)).toEqual(['售完时间']);
    for (const [state, titles] of Object.entries({
      warehouse: ['入库人', '入库时间'],
      selling: ['上架人', '上架时间'],
      recycle: ['移入人', '移入时间'],
    })) {
      expect(stateActivityColumns(state).map((column) => column.title)).toEqual(titles);
    }
  });
});
