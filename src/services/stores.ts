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
  status: 'enabled' | 'disabled';
  remark?: string;
  createdBy?: string;
}

export interface StoreReferenceItem {
  code: string;
  name: string;
  count: number;
  examples: string[];
}

export interface StoreReferenceSummary {
  totalCount: number;
  references: StoreReferenceItem[];
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

export function getStoreDeletionReferences(id: number) {
  return request<StoreReferenceSummary>(`/admin/stores/${id}/deletion-references`);
}
