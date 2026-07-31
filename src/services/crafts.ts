import { request } from './http';

export interface CraftRecord {
  id: number;
  name: string;
  type: string;
  width?: string;
  description?: string;
  imageUrl?: string;
  pricingMethod?: string;
  remark?: string;
  status?: 'enabled' | 'disabled';
  createdByName?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface CraftPayload {
  name: string;
  type: string;
  width?: string;
  description?: string;
  imageUrl?: string;
  pricingMethod?: string;
  remark?: string;
  status: 'enabled' | 'disabled';
}

export interface CraftImageUploadResponse {
  url: string;
}

export function listCrafts() {
  return request<CraftRecord[]>('/admin/crafts');
}

export function createCraft(payload: CraftPayload) {
  return request<CraftRecord>('/admin/crafts', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function updateCraft(id: number, payload: CraftPayload) {
  return request<CraftRecord>(`/admin/crafts/${id}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
}

export function updateCraftStatus(id: number, status: CraftPayload['status']) {
  return request<CraftRecord>(`/admin/crafts/${id}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  });
}

export function uploadCraftImage(file: File) {
  const body = new FormData();
  body.append('file', file);
  return request<CraftImageUploadResponse>('/admin/crafts/images', {
    method: 'POST',
    body,
  });
}

export function deleteCraft(id: number) {
  return request<boolean>(`/admin/crafts/${id}`, {
    method: 'DELETE',
  });
}
