import { request } from './http';

export interface SlabGradeRecord {
  id: number;
  code: string;
  name: string;
  sortOrder: number;
  createdByName?: string;
  createdByAccountId?: number;
  remark?: string;
  status?: 'enabled' | 'disabled';
  createdAt?: string;
  updatedAt?: string;
}

export interface SlabGradePayload {
  code: string;
  name: string;
  remark?: string;
  status: 'enabled' | 'disabled';
}

export const listSlabGrades = () => request<SlabGradeRecord[]>('/admin/slab-grades');
export const createSlabGrade = (payload: SlabGradePayload) =>
  request<SlabGradeRecord>('/admin/slab-grades', { method: 'POST', body: JSON.stringify(payload) });
export const updateSlabGrade = (id: number, payload: SlabGradePayload) =>
  request<SlabGradeRecord>(`/admin/slab-grades/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
export const updateSlabGradeStatus = (id: number, status: SlabGradePayload['status']) =>
  request<SlabGradeRecord>(`/admin/slab-grades/${id}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  });
export const reorderSlabGrades = (orderedIds: number[]) =>
  request<SlabGradeRecord[]>('/admin/slab-grades/reorder', {
    method: 'PATCH',
    body: JSON.stringify({ orderedIds }),
  });
export const deleteSlabGrade = (id: number) => request<boolean>(`/admin/slab-grades/${id}`, { method: 'DELETE' });
