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
export const finishedLogStates: Record<string, string> = {
  warehouse: '仓库中',
  selling: '已上架',
  offShelf: '已下架',
  soldOut: '已售完',
  recycle: '回收站',
  purged: '已彻底删除',
};
