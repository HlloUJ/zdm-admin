import { request } from './http';
export interface BatchShelfFailure {
  id: number;
  code: string;
  reason: string;
}
export interface BatchShelfResult {
  total: number;
  successCount: number;
  failureCount: number;
  failures: BatchShelfFailure[];
}
export function batchShelfProducts(resource: 'finished-products' | 'accessory-products' | 'slabs', ids: number[]) {
  return request<BatchShelfResult>(`/admin/${resource}/batch-shelf`, { method: 'POST', body: JSON.stringify({ ids }) });
}
export function groupShelfFailures(failures: BatchShelfFailure[]) {
  const groups = new Map<string, { key: string; productIds: string; reason: string; ids: number[] }>();
  for (const failure of failures) {
    const key = failure.reason;
    const group = groups.get(key) || { key, productIds: '', reason: failure.reason, ids: [] };
    if (!group.ids.includes(failure.id)) group.ids.push(failure.id);
    group.productIds = group.ids.join('、');
    groups.set(key, group);
  }
  return [...groups.values()];
}
