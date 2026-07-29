import { request } from './http';

export interface StoreRecord {
  id: number;
  tenantId: number;
  name: string;
  type: 'cityPartner' | 'slabSupplier' | 'finishedSupplier' | 'factory';
  shopLevel?: 'level1' | 'level2' | 'level3';
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
  shopLevel?: 'level1' | 'level2' | 'level3';
  manager?: string;
  region?: string;
  detailAddress?: string;
  address?: string;
  status: 'enabled' | 'disabled';
  remark?: string;
  createdBy?: string;
}

export function listStores() {
  return request<StoreRecord[]>('/admin/stores');
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

export function deleteStore(id: number) {
  return request<boolean>(`/admin/stores/${id}`, {
    method: 'DELETE',
  });
}
