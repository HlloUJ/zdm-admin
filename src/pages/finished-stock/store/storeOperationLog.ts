import type { ProductOperationLogRow } from '@/services/productOperationLog';
import type { StoreFinishedLog } from '@/services/storeFinishedStock';

export const toStoreOperationLogRow = (row: StoreFinishedLog): ProductOperationLogRow => ({
  id: row.id,
  subjectName: row.productName,
  subjectId: row.productId,
  operationType: row.operationType,
  operationSummary: row.operationSummary,
  operatorName: row.operatorName,
  operatedAt: row.operatedAt,
  beforeStatus:
    row.operationType.startsWith('SOURCE_') || row.operationType.startsWith('OPERATIONS_') ? null : row.beforeStatus,
  afterStatus:
    row.operationType.startsWith('SOURCE_') || row.operationType.startsWith('OPERATIONS_') ? null : row.afterStatus,
});

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
    return Object.fromEntries(
      Object.entries(details).map(([field, entry]) => {
        const change =
          entry && typeof entry === 'object' && 'before' in entry && 'after' in entry
            ? (entry as { before: unknown; after: unknown })
            : { before: null, after: entry };
        return [
          field,
          ['状态', '来源状态', '运营状态'].includes(field)
            ? { before: stateLabel(change.before as string), after: stateLabel(change.after as string) }
            : change,
        ];
      }),
    );
  } catch {
    return {};
  }
}
