import { request } from './http';

export interface StoreLevelRecord {
  id: number;
  name: string;
  createdByName?: string;
  createdByAccountId?: number;
  remark?: string;
  status?: 'enabled' | 'disabled';
  createdAt?: string;
  updatedAt?: string;
}

export interface StoreLevelPayload {
  name: string;
  remark?: string;
  status: 'enabled' | 'disabled';
}

export const listStoreLevels = () => request<StoreLevelRecord[]>('/admin/store-levels');
export const listStoreLevelOptions = () => request<StoreLevelRecord[]>('/admin/stores/level-options');
export const createStoreLevel = (payload: StoreLevelPayload) =>
  request<StoreLevelRecord>('/admin/store-levels', { method: 'POST', body: JSON.stringify(payload) });
export const updateStoreLevel = (id: number, payload: StoreLevelPayload) =>
  request<StoreLevelRecord>(`/admin/store-levels/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
export const updateStoreLevelStatus = (id: number, status: StoreLevelPayload['status']) =>
  request<StoreLevelRecord>(`/admin/store-levels/${id}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  });
export const deleteStoreLevel = (id: number) => request<boolean>(`/admin/store-levels/${id}`, { method: 'DELETE' });
