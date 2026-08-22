import { request } from './http';
import { releaseTemporaryMedia, uploadMedia, type MediaResource } from './media';

export interface CraftRecord {
  id: number;
  name: string;
  type: string;
  width?: string;
  description?: string;
  imageMediaId?: number;
  imageUrl?: string;
  pricingMethod?: string;
  remark?: string;
  status?: 'enabled' | 'disabled';
  createdByName?: string;
  createdByAccountId?: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface CraftPayload {
  name: string;
  type: string;
  width?: string;
  description?: string;
  imageMediaId?: number;
  pricingMethod?: string;
  remark?: string;
  status: 'enabled' | 'disabled';
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
  return uploadMedia('/admin/crafts/images', file);
}

export function releaseTemporaryCraftImage(mediaId: MediaResource['id']) {
  return releaseTemporaryMedia('/admin/crafts/images', mediaId);
}

export function deleteCraft(id: number) {
  return request<boolean>(`/admin/crafts/${id}`, {
    method: 'DELETE',
  });
}
