import { request } from './http';

export type StoreCategoryStatus = 'enabled' | 'disabled';

export interface StoreCategoryRecord {
  id: number;
  parentId?: number | null;
  name: string;
  sortOrder: number;
  productCount: number;
  status: StoreCategoryStatus;
  createdByName?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface StoreCategoryCreatePayload {
  parentId?: number | null;
  name: string;
  status: StoreCategoryStatus;
}

export function listStoreCategories() {
  return request<StoreCategoryRecord[]>('/admin/store-categories');
}

export function createStoreCategory(payload: StoreCategoryCreatePayload) {
  return request<StoreCategoryRecord>('/admin/store-categories', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function updateStoreCategory(id: number, name: string) {
  return request<StoreCategoryRecord>(`/admin/store-categories/${id}`, {
    method: 'PUT',
    body: JSON.stringify({ name }),
  });
}

export function updateStoreCategoryStatus(id: number, status: StoreCategoryStatus) {
  return request<StoreCategoryRecord>(`/admin/store-categories/${id}/status`, {
    method: 'PUT',
    body: JSON.stringify({ status }),
  });
}

export function moveStoreCategory(id: number, direction: 'up' | 'down') {
  return request<StoreCategoryRecord>(`/admin/store-categories/${id}/move`, {
    method: 'PUT',
    body: JSON.stringify({ direction }),
  });
}

export function deleteStoreCategory(id: number) {
  return request<boolean>(`/admin/store-categories/${id}`, { method: 'DELETE' });
}
