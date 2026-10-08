import { describe, expect, it } from 'vitest';
import { productOperationSummary, productOperationTypeLabel, productOperationTypeOptions } from './productOperationLog';

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

  it('offers one restore filter while retaining historical restore codes', () => {
    expect(productOperationTypeOptions(['RESTORE', 'RESTORE_WAREHOUSE', 'RESTORE_RECYCLE'])).toEqual([
      { value: 'RESTORE', label: '放回仓库' },
    ]);
  });

  it('groups historical manual price changes under product edits', () => {
    expect(productOperationTypeOptions(['UPDATE', 'PRICE_UPDATE'])).toEqual([{ value: 'UPDATE', label: '编辑商品' }]);
  });
});
