export interface ProductOperationLogRow {
  id: number;
  subjectName: string;
  subjectId: number;
  subjectCode?: string;
  operationType: string;
  operationSummary: string;
  operatorName: string;
  operatedAt: string;
  operationSource?: string;
  beforeStatus?: string | null;
  afterStatus?: string | null;
  standardReason?: string | null;
  detailReason?: string | null;
}

// Every product log uses this vocabulary. A screen may show only the actions
// that its business client can actually produce.
export const productOperationTypes: Record<string, string> = {
  CREATE: '创建',
  SELECT: '挑选商品',
  UPDATE: '编辑信息',
  PRICE_UPDATE: '修改价格',
  SHELF: '上架',
  OFF_SHELF: '下架',
  RESTORE: '放回仓库',
  RESTORE_WAREHOUSE: '放回仓库',
  RESTORE_RECYCLE: '放回仓库',
  DELETE_TO_RECYCLE: '移入回收站',
  PHYSICAL_DELETE: '物理删除',
  PURGE: '彻底删除',
  SOLD_OUT: '售完',
  STATUS_UPDATE: '状态变更',
  SOURCE_SHELF: '供应链上架',
  SOURCE_OFF_SHELF: '供应链下架',
  SOURCE_DELETE: '供应链删除',
  SOURCE_INTERNAL: '供应链状态变更',
  OPERATIONS_OFF_SHELF: '运营端下架',
  OPERATIONS_SHELF: '运营端上架',
  OPERATIONS_DELETE_TO_RECYCLE: '运营端移入回收站',
  OPERATIONS_PURGE: '运营端彻底删除',
};

const fixedSummaries: Record<string, string> = {
  CREATE: '创建商品',
  SELECT: '挑选商品进入仓库',
  UPDATE: '编辑商品',
  SHELF: '上架商品',
  OFF_SHELF: '下架商品',
  RESTORE: '放回仓库',
  RESTORE_WAREHOUSE: '放回仓库',
  RESTORE_RECYCLE: '放回仓库',
  DELETE_TO_RECYCLE: '删除至回收站',
  PURGE: '彻底删除商品',
  PHYSICAL_DELETE: '物理删除商品',
  SOLD_OUT: '商品售罄',
  SOURCE_OFF_SHELF: '供应链已下架该商品',
  SOURCE_DELETE: '供应链已删除该商品',
  OPERATIONS_OFF_SHELF: '运营端已下架该商品',
  OPERATIONS_SHELF: '运营端已重新上架该商品',
  OPERATIONS_DELETE_TO_RECYCLE: '运营端已将该商品移入回收站',
  OPERATIONS_PURGE: '运营端已彻底删除该商品',
};

export function productOperationTypeLabel(type: string): string {
  return productOperationTypes[type] || type;
}

export function canonicalProductOperationType(type: string): string {
  return ['RESTORE_WAREHOUSE', 'RESTORE_RECYCLE'].includes(type) ? 'RESTORE' : type;
}

export function productOperationSummary(
  row: Pick<ProductOperationLogRow, 'operationType' | 'operationSummary'>,
): string {
  return fixedSummaries[row.operationType] || row.operationSummary;
}

export function productOperationTypeOptions(types: readonly string[]) {
  return [...new Set(types.map(canonicalProductOperationType))].map((value) => ({
    value,
    label: productOperationTypeLabel(value),
  }));
}

export function productLogTime(value?: string): string {
  return value ? value.replace('T', ' ').slice(0, 16).replaceAll('-', '/') : '—';
}
