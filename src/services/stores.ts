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

export function deleteStore(id: number) {
  return request<boolean>(`/admin/stores/${id}`, {
    method: 'DELETE',
  });
}
