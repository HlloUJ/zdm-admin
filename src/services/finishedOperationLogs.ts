import { request } from './http';
export interface FinishedOperationLog {
  id: number;
  productId: number;
  productName: string;
  merchantCode?: string;
  operationType: string;
  operationSummary: string;
  beforeStatus?: string;
  afterStatus?: string;
  standardReason?: string;
  detailReason?: string;
  batchNo?: string;
  operatorName: string;
  operatedAt: string;
  operationSource: string;
  changeDetails: string;
}
export interface FinishedLogFilter {
  keyword: string;
  operationType: string;
  operatorName: string;
  startDate: string;
  endDate: string;
  page: number;
  pageSize: number;
}
export const listFinishedOperationLogs = (filter: FinishedLogFilter) => {
  const query = new URLSearchParams();
  Object.entries(filter).forEach(([key, value]) => {
    if (value !== '') query.set(key, String(value));
  });
  return request<{ records: FinishedOperationLog[]; total: number }>(
    `/admin/finished-products/operation-logs?${query}`,
  );
};
export const getFinishedOperationLog = (id: number) =>
  request<FinishedOperationLog>(`/admin/finished-products/operation-logs/${id}`);
export const finishedLogTypes: Record<string, string> = {
  CREATE: '创建商品',
  UPDATE: '编辑商品',
  PRICE_UPDATE: '修改价格',
  SHELF: '上架商品',
  OFF_SHELF: '下架商品',
  RESTORE: '放回仓库',
  DELETE_TO_RECYCLE: '删除至回收站',
  PURGE: '彻底删除商品',
  SOLD_OUT: '商品售罄',
};
export const finishedLogStates: Record<string, string> = {
  warehouse: '仓库中',
  selling: '出售中',
  offShelf: '已下架',
  soldOut: '已售完',
  recycle: '回收站',
};
