import { request } from './http';

export interface SlabVarietyRecord {
  id: number;
  name: string;
  code: string;
  originId?: number;
  color?: string;
  createdByName?: string;
  remark?: string;
  status?: 'enabled' | 'disabled';
  createdAt?: string;
  updatedAt?: string;
}

export interface SlabVarietyPayload {
  name: string;
  code: string;
  originId?: number;
  color?: string;
  remark?: string;
  status: 'enabled' | 'disabled';
}

export function listSlabVarieties() {
  return request<SlabVarietyRecord[]>('/admin/slab-varieties');
}

export function createSlabVariety(payload: SlabVarietyPayload) {
  return request<SlabVarietyRecord>('/admin/slab-varieties', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function updateSlabVariety(id: number, payload: SlabVarietyPayload) {
  return request<SlabVarietyRecord>(`/admin/slab-varieties/${id}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
}

export function updateSlabVarietyStatus(id: number, status: SlabVarietyPayload['status']) {
  return request<SlabVarietyRecord>(`/admin/slab-varieties/${id}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  });
}

export function deleteSlabVariety(id: number) {
  return request<boolean>(`/admin/slab-varieties/${id}`, {
    method: 'DELETE',
  });
}
