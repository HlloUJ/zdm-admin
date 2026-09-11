import { describe, expect, it } from 'vitest';
import { sortByOffShelfAtDesc } from './offShelfSorting';
describe('下架时间排序', () => {
  it('按下架时间倒序，旧数据与无效时间排末尾，不修改原数组', () => {
    const rows = [
      { id: 9 },
      { id: 1, offShelfAt: '2026-09-10T12:00:00' },
      { id: 2, offShelfAt: '2026-09-10T13:00:00' },
      { id: 8, offShelfAt: 'invalid' },
    ];
    expect(sortByOffShelfAtDesc(rows).map((row) => row.id)).toEqual([2, 1, 9, 8]);
    expect(rows[0].id).toBe(9);
  });
});
