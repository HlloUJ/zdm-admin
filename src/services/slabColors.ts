import { request } from './http';

export interface SlabColorCategoryRecord {
  id: number;
  name: string;
  createdByName?: string;
  remark?: string;
  createdAt?: string;
}

export interface SlabColorRecord {
  id: number;
  categoryId: number;
  categoryName: string;
  name: string;
  status: 'enabled' | 'disabled';
  createdByName?: string;
  remark?: string;
  createdAt?: string;
}

export interface SlabColorPayload {
  categoryId: number;
  name: string;
  status: 'enabled' | 'disabled';
  remark?: string;
}

export interface SlabColorCategoryPayload {
  name: string;
  remark?: string;
}

export const listSlabColors = () => request<SlabColorRecord[]>('/admin/slab-colors');
export const createSlabColor = (payload: SlabColorPayload) =>
  request<SlabColorRecord>('/admin/slab-colors', { method: 'POST', body: JSON.stringify(payload) });
export const updateSlabColor = (id: number, payload: SlabColorPayload) =>
  request<SlabColorRecord>(`/admin/slab-colors/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
export const updateSlabColorStatus = (id: number, status: SlabColorPayload['status']) =>
  request<SlabColorRecord>(`/admin/slab-colors/${id}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  });
export const deleteSlabColor = (id: number) => request<boolean>(`/admin/slab-colors/${id}`, { method: 'DELETE' });

export const listSlabColorCategories = () => request<SlabColorCategoryRecord[]>('/admin/slab-colors/categories');
export const createSlabColorCategory = (payload: SlabColorCategoryPayload) =>
  request<SlabColorCategoryRecord>('/admin/slab-colors/categories', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
export const updateSlabColorCategory = (id: number, payload: SlabColorCategoryPayload) =>
  request<SlabColorCategoryRecord>(`/admin/slab-colors/categories/${id}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
export const deleteSlabColorCategory = (id: number) =>
  request<boolean>(`/admin/slab-colors/categories/${id}`, { method: 'DELETE' });
