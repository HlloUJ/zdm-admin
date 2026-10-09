import { describe, expect, it } from 'vitest';
import {
  finishedProductOperationSummary,
  productOperationSummary,
  productOperationTypeLabel,
  productOperationTypeOptions,
} from './productOperationLog';

describe('shared product operation vocabulary', () => {
  it('uses one label and summary for the same action across product types', () => {
    expect(productOperationTypeLabel('OFF_SHELF')).toBe('下架');
    expect(productOperationSummary({ operationType: 'OFF_SHELF', operationSummary: '下架大板' })).toBe('下架商品');
    expect(productOperationSummary({ operationType: 'OFF_SHELF', operationSummary: '下架商品' })).toBe('下架商品');
    expect(productOperationSummary({ operationType: 'PRICE_UPDATE', operationSummary: '修改本店指导价' })).toBe(
      '编辑商品',
    );
    expect(productOperationTypeLabel('PRICE_UPDATE')).toBe('编辑商品');
    expect(productOperationTypeLabel('OPERATIONS_OFF_SHELF')).toBe('运营管理平台下架');
  });

  it.each([
    ['SOURCE_OFF_SHELF', '该商品已被供应链下架'],
    ['SOURCE_DELETE_TO_RECYCLE', '该商品已被供应链删除至回收站'],
    ['SOURCE_PURGE', '该商品已被供应链彻底删除'],
    ['OPERATIONS_OFF_SHELF', '该商品已被运营管理平台下架'],
    ['OPERATIONS_DELETE_TO_RECYCLE', '该商品已被运营管理平台删除至回收站'],
    ['OPERATIONS_PURGE', '该商品已被运营管理平台彻底删除'],
  ])('aligns finished-stock %s summaries without rewriting unrelated product logs', (operationType, expected) => {
    const row = { operationType, operationSummary: '旧日志文案' };
    expect(finishedProductOperationSummary(row)).toBe(expected);
    expect(productOperationSummary(row)).not.toBe(expected);
  });

  it('offers one restore filter while retaining historical restore codes', () => {
    expect(productOperationTypeOptions(['RESTORE', 'RESTORE_WAREHOUSE', 'RESTORE_RECYCLE'])).toEqual([
      { value: 'RESTORE', label: '放回仓库' },
    ]);
  });

  it('groups historical manual price changes under product edits', () => {
    expect(productOperationTypeOptions(['UPDATE', 'PRICE_UPDATE'])).toEqual([{ value: 'UPDATE', label: '编辑商品' }]);
  });
});
