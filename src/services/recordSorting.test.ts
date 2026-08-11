import { describe, expect, it } from 'vitest';

import { sortByCreatedAtDesc } from './recordSorting';

describe('sortByCreatedAtDesc', () => {
  it('按创建时间倒序排列，并在时间相同时按编号倒序保持稳定结果', () => {
    const records = [
      { id: 1, name: '较早记录', createdAt: '2026-08-01T09:00:00' },
      { id: 2, name: '较新记录', createdAt: '2026-08-03T09:00:00' },
      { id: 3, name: '同时间后创建记录', createdAt: '2026-08-03T09:00:00' },
      { id: 4, name: '无创建时间记录' },
    ];

    expect(sortByCreatedAtDesc(records).map((record) => record.name)).toEqual([
      '同时间后创建记录',
      '较新记录',
      '较早记录',
      '无创建时间记录',
    ]);
    expect(records.map((record) => record.name)).toEqual([
      '较早记录',
      '较新记录',
      '同时间后创建记录',
      '无创建时间记录',
    ]);
  });
});
