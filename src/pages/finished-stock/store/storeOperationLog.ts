import type { ProductOperationLogRow } from '@/services/productOperationLog';
import type { StoreFinishedLog } from '@/services/storeFinishedStock';

export const isStoreStatusOperation = (type: string) =>
  [
    'SHELF',
    'OFF_SHELF',
    'RESTORE',
    'RESTORE_WAREHOUSE',
    'RESTORE_RECYCLE',
    'DELETE_TO_RECYCLE',
    'PURGE',
    'PHYSICAL_DELETE',
    'SOLD_OUT',
    'STATUS_UPDATE',
  ].includes(type);

export const toStoreOperationLogRow = (row: StoreFinishedLog): ProductOperationLogRow => {
  const reasons = ['OFF_SHELF', 'SOURCE_UPDATE'].includes(row.operationType)
    ? parseStoreOperationLogChanges(row.changeDetails, (value) => value || '')
    : {};
  return {
    id: row.id,
    subjectName: row.productName,
    subjectId: row.productId,
    operationType: row.operationType,
    operationSummary: row.operationSummary,
    operatorName: row.operatorName,
    operatedAt: row.operatedAt,
    beforeStatus: row.beforeStatus,
    afterStatus: row.afterStatus,
    standardReason: typeof reasons['下架原因']?.after === 'string' ? reasons['下架原因'].after : undefined,
    detailReason: typeof reasons['详细说明']?.after === 'string' ? reasons['详细说明'].after : undefined,
  };
};

export const storeOperationLogSourceLabel = (row: ProductOperationLogRow) =>
  row.operationType.startsWith('SOURCE_')
    ? '供应链协同系统'
    : row.operationType.startsWith('OPERATIONS_')
      ? '运营管理平台'
      : '合伙人门店';

export function parseStoreOperationLogChanges(
  value: string | null | undefined,
  stateLabel: (status?: string | null) => string,
): Record<string, { before: unknown; after: unknown }> {
  if (!value) return {};
  try {
    const details = JSON.parse(value) as Record<string, unknown>;
    const changes = Object.fromEntries(
      Object.entries(details).map(([field, entry]) => {
        const change =
          entry && typeof entry === 'object' && 'before' in entry && 'after' in entry
            ? (entry as { before: unknown; after: unknown })
            : { before: null, after: entry };
        const displayField = field === '运营状态' ? '来源状态' : field;
        const label = (status: unknown) =>
          displayField === '来源状态' && status === 'selling' ? '已上架' : stateLabel(status as string);
        return [
          displayField,
          ['状态', '来源状态', '运营状态'].includes(field)
            ? { before: label(change.before), after: label(change.after) }
            : change,
        ];
      }),
    );
    const skuFields = Object.keys(changes).filter((field) => /^SKU \d+$/.test(field));
    if (skuFields.length && !changes['销售规格']) {
      const rows = (side: 'before' | 'after') =>
        skuFields.map((field) => {
          const recorded = changes[field][side] as Record<string, unknown> | null;
          const row: Record<string, unknown> = { skuId: Number(field.slice(4)), variantLabel: field };
          if (recorded && '商品售价' in recorded) row.salePrice = recorded['商品售价'];
          if (recorded && '售价系数' in recorded) row.saleCoefficient = recorded['售价系数'];
          if (recorded && '售价模式' in recorded)
            row.priceMode = recorded['售价模式'] === '跟随配置' ? 'auto' : 'manual';
          return row;
        });
      changes['销售规格'] = { before: rows('before'), after: rows('after') };
      skuFields.forEach((field) => {
        delete changes[field];
      });
    }
    return changes;
  } catch {
    return {};
  }
}
