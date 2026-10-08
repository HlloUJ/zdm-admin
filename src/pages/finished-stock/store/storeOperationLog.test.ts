import { describe, expect, it } from 'vitest';
import type { StoreFinishedLog } from '@/services/storeFinishedStock';
import {
  isStoreStatusOperation,
  parseStoreOperationLogChanges,
  storeOperationLogSourceLabel,
  toStoreOperationLogRow,
} from './storeOperationLog';

const log = (operationType: string): StoreFinishedLog => ({
  id: 1,
  productId: 2,
  productName: '成品现货',
  operationType,
  operationSummary: '状态变化',
  beforeStatus: 'warehouse',
  afterStatus: 'selling',
  operatorName: '操作人',
  operatedAt: '2026-09-29T10:00:00',
});

describe('store finished-stock operation log', () => {
  it('preserves historical store statuses for store and upstream operations', () => {
    const source = toStoreOperationLogRow(log('SOURCE_SHELF'));
    const operations = toStoreOperationLogRow(log('OPERATIONS_SHELF'));
    const store = toStoreOperationLogRow(log('SHELF'));

    expect(source.beforeStatus).toBe('warehouse');
    expect(source.afterStatus).toBe('selling');
    expect(operations.beforeStatus).toBe('warehouse');
    expect(operations.afterStatus).toBe('selling');
    expect(store.beforeStatus).toBe('warehouse');
    expect(storeOperationLogSourceLabel(source)).toBe('供应链协同系统');
    expect(storeOperationLogSourceLabel(operations)).toBe('运营管理平台');
    expect(storeOperationLogSourceLabel(store)).toBe('合伙人门店');
  });

  it('presents both upstream status fields as source status while preserving local status wording', () => {
    const label = (value?: string | null) => value === 'selling' ? '出售中' : '已下架';
    for (const field of ['来源状态', '运营状态']) {
      expect(parseStoreOperationLogChanges(JSON.stringify({
        [field]: { before: 'selling', after: 'offShelf' },
        状态: { before: 'selling', after: 'offShelf' },
      }), label)).toEqual({
        来源状态: { before: '已上架', after: '已下架' },
        状态: { before: '出售中', after: '已下架' },
      });
    }
  });

  it('suppresses only store state comparisons and exposes off-shelf reasons', () => {
    for (const type of ['SHELF', 'OFF_SHELF', 'RESTORE', 'RESTORE_WAREHOUSE', 'RESTORE_RECYCLE',
      'DELETE_TO_RECYCLE', 'PURGE', 'PHYSICAL_DELETE', 'SOLD_OUT', 'STATUS_UPDATE']) {
      expect(isStoreStatusOperation(type)).toBe(true);
    }
    for (const type of ['SELECT', 'UPDATE', 'PRICE_UPDATE', 'SOURCE_OFF_SHELF', 'OPERATIONS_OFF_SHELF']) {
      expect(isStoreStatusOperation(type)).toBe(false);
    }
    const changeDetails = JSON.stringify({ 下架原因: '商品信息调整', 详细说明: '调整规格后重新上架' });
    const offShelf = toStoreOperationLogRow({ ...log('OFF_SHELF'), changeDetails });
    expect(offShelf.standardReason).toBe('商品信息调整');
    expect(offShelf.detailReason).toBe('调整规格后重新上架');
    expect(toStoreOperationLogRow({ ...log('PURGE'), changeDetails }).standardReason).toBeUndefined();
    expect(toStoreOperationLogRow({ ...log('OFF_SHELF'), changeDetails: '{' }).standardReason).toBeUndefined();
  });

  it('formats only status fields and tolerates invalid detail JSON', () => {
    const labels: Record<string, string> = { warehouse: '仓库中', selling: '出售中' };
    const label = (value?: string | null) => labels[value || ''] || '—';
    expect(
      parseStoreOperationLogChanges(
        JSON.stringify({ 状态: { before: 'warehouse', after: 'selling' }, 备注: '已更新' }),
        label,
      ),
    ).toEqual({ 状态: { before: '仓库中', after: '出售中' }, 备注: { before: null, after: '已更新' } });
    expect(parseStoreOperationLogChanges('{', label)).toEqual({});
  });
});
