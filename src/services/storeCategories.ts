import { request } from './http';

export type StoreCategoryScope = 'finished' | 'accessory';
export type StoreCategoryStatus = 'enabled' | 'disabled';

export interface StoreCategoryRecord {
  id: number;
  scope: StoreCategoryScope;
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
  scope: StoreCategoryScope;
  parentId?: number | null;
  name: string;
  status: StoreCategoryStatus;
}

const base = '/admin/store-categories';
export const listStoreCategories = (scope: StoreCategoryScope) =>
  request<StoreCategoryRecord[]>(`${base}?scope=${scope}`);
export const createStoreCategory = (payload: StoreCategoryCreatePayload) =>
  request<StoreCategoryRecord>(base, { method: 'POST', body: JSON.stringify(payload) });
export const updateStoreCategory = (
  id: number,
  scope: StoreCategoryScope,
  name: string,
  status?: StoreCategoryStatus,
) =>
  request<StoreCategoryRecord>(`${base}/${id}?scope=${scope}`, {
    method: 'PUT',
    body: JSON.stringify({ name, status }),
  });
export const updateStoreCategoryStatus = (id: number, scope: StoreCategoryScope, status: StoreCategoryStatus) =>
  request<StoreCategoryRecord>(`${base}/${id}/status?scope=${scope}`, {
    method: 'PUT',
    body: JSON.stringify({ status }),
  });
export const sortStoreCategories = (scope: StoreCategoryScope, parentId: number | null, orderedIds: number[]) =>
  request<StoreCategoryRecord[]>(`${base}/sort`, {
    method: 'PUT',
    body: JSON.stringify({ scope, parentId, orderedIds }),
  });
export const deleteStoreCategory = (id: number, scope: StoreCategoryScope) =>
  request<boolean>(`${base}/${id}?scope=${scope}`, { method: 'DELETE' });
