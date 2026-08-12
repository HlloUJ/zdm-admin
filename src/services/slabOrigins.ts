import { request } from './http';

export interface SlabOriginRecord {
  id: number;
  name: string;
  createdByName?: string;
  remark?: string;
  status?: 'enabled' | 'disabled';
  createdAt?: string;
  updatedAt?: string;
}

export interface SlabOriginPayload {
  name: string;
  remark?: string;
  status: 'enabled' | 'disabled';
}

export function listSlabOrigins() {
  return request<SlabOriginRecord[]>('/admin/slab-origins');
}

export function createSlabOrigin(payload: SlabOriginPayload) {
  return request<SlabOriginRecord>('/admin/slab-origins', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function updateSlabOrigin(id: number, payload: SlabOriginPayload) {
  return request<SlabOriginRecord>(`/admin/slab-origins/${id}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
}

export function updateSlabOriginStatus(id: number, status: SlabOriginPayload['status']) {
  return request<SlabOriginRecord>(`/admin/slab-origins/${id}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  });
}

export function deleteSlabOrigin(id: number) {
  return request<boolean>(`/admin/slab-origins/${id}`, {
    method: 'DELETE',
  });
}
