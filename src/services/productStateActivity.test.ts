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
  it('keeps missing state times last without substituting creation and stabilizes equal times', () => {
    expect(sortByStateActivity([{ id: 1 }, { id: 2 }]).map((row) => row.id)).toEqual([2, 1]);
    expect(
      sortByStateActivity([
        { id: 1, createdAt: '2026-10-12' },
        { id: 2, stateOperatedAt: '2026-10-11' },
      ]).map((row) => row.id),
    ).toEqual([2, 1]);
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

it('sorts complete arrays in either direction with stable ties and missing times last', () => {
  const records = [
    { id: 1, stateOperatedAt: '2026-10-01T00:00:00Z' },
    { id: 3, stateOperatedAt: '2026-10-02T00:00:00Z' },
    { id: 2, stateOperatedAt: '2026-10-02T00:00:00Z' },
    { id: 4, createdAt: '2030-01-01' },
    { id: 5, stateOperatedAt: '1970-01-01T00:00:00Z' },
  ];
  expect(sortByStateActivity(records, false).map((r) => r.id)).toEqual([5, 1, 2, 3, 4]);
  expect(sortByStateActivity(records, true).map((r) => r.id)).toEqual([3, 2, 1, 5, 4]);
  expect(records.map((r) => r.id)).toEqual([1, 3, 2, 4, 5]);
});
