import { request } from './http';

export interface StoreRecord {
  id: number;
  tenantId: number;
  name: string;
  type: 'cityPartner' | 'slabSupplier' | 'finishedSupplier' | 'factory';
  storeLevelId?: number;
  manager?: string;
  region?: string;
  detailAddress?: string;
  address?: string;
  status: 'enabled' | 'disabled';
  remark?: string;
  createdAt?: string;
  createdBy?: string;
  updatedAt?: string;
}

export interface StorePayload {
  tenantId: number;
  name: string;
  type: 'cityPartner' | 'slabSupplier' | 'finishedSupplier' | 'factory';
  storeLevelId: number;
  manager?: string;
  region?: string;
  detailAddress?: string;
  address?: string;
  remark?: string;
  createdBy?: string;
}

export function listStores(scope: 'operating' | 'archived') {
  return request<StoreRecord[]>(`/admin/stores?scope=${scope}`);
}

export function createStore(payload: StorePayload) {
  return request<StoreRecord>('/admin/stores', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function updateStore(id: number, payload: StorePayload) {
  return request<StoreRecord>(`/admin/stores/${id}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
}

export function updateStoreLevelSelection(id: number, storeLevelId: number) {
  return request<StoreRecord>(`/admin/stores/${id}/level`, {
    method: 'PATCH',
    body: JSON.stringify({ storeLevelId }),
  });
}

export function archiveStore(id: number) {
  return request<StoreRecord>(`/admin/stores/${id}/archive`, { method: 'PATCH' });
}

export function restoreStore(id: number) {
  return request<StoreRecord>(`/admin/stores/${id}/restore`, { method: 'PATCH' });
}

export interface StoreExitPreview {
  storeId: number;
  tenantId: number;
  storeName: string;
  ruleVersion: string;
  planHash: string;
  counts: Record<string, number>;
  retained: string[];
  blockers: string[];
  eligible: boolean;
}

export function getStorePurgePreview(id: number) {
  return request<StoreExitPreview>(`/admin/stores/${id}/purge-preview`);
}

export interface StoreExitResult {
  operationId: string;
  storeId: number;
  databaseStatus: 'CLEARED';
  cleanupStatus: 'COMPLETE' | 'PENDING' | 'ATTENTION';
  pendingTasks: number;
  retained: string[];
}

export function getStorePurgeResult(id: number) {
  return request<StoreExitResult>(`/admin/stores/${id}/purge-result`);
}

export function deleteStore(id: number, planHash: string) {
  return request<StoreExitResult>(`/admin/stores/${id}?planHash=${encodeURIComponent(planHash)}`, {
    method: 'DELETE',
  });
}
