import { describe, expect, it } from 'vitest';
import type { StoreFinishedLog } from '@/services/storeFinishedStock';
import {
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
  it('hides upstream statuses while keeping store statuses and source labels', () => {
    const source = toStoreOperationLogRow(log('SOURCE_SHELF'));
    const operations = toStoreOperationLogRow(log('OPERATIONS_SHELF'));
    const store = toStoreOperationLogRow(log('SHELF'));

    expect(source.beforeStatus).toBeNull();
    expect(operations.afterStatus).toBeNull();
    expect(store.beforeStatus).toBe('warehouse');
    expect(storeOperationLogSourceLabel(source)).toBe('供应链协同系统');
    expect(storeOperationLogSourceLabel(operations)).toBe('运营管理平台');
    expect(storeOperationLogSourceLabel(store)).toBe('合伙人门店');
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
