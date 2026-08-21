import { request } from './http';

export type MarkupProductType = 'finished' | 'slab';
export type MarkupConfigurationStatus = 'enabled' | 'disabled';

export interface MarkupConfigurationRecord {
  id: number;
  productType: MarkupProductType;
  name: string;
  markupRate: number;
  sortOrder: number;
  status: MarkupConfigurationStatus;
  createdByName?: string;
  createdByAccountId?: number;
  createdAt?: string;
  updatedAt?: string;
  referenced: boolean;
}

export interface MarkupConfigurationPayload {
  productType: MarkupProductType;
  name: string;
  markupRate: number;
}

export function listMarkupConfigurations(productType: MarkupProductType) {
  return request<MarkupConfigurationRecord[]>(`/admin/markup-configurations?productType=${productType}`);
}

export function listMarkupConfigurationOptions(productType: MarkupProductType) {
  return request<MarkupConfigurationRecord[]>(`/admin/markup-configurations/options?productType=${productType}`);
}

export function createMarkupConfiguration(payload: MarkupConfigurationPayload) {
  return request<MarkupConfigurationRecord>('/admin/markup-configurations', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function updateMarkupConfiguration(id: number, payload: MarkupConfigurationPayload) {
  return request<MarkupConfigurationRecord>(`/admin/markup-configurations/${id}?productType=${payload.productType}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
}

export function updateMarkupConfigurationStatus(
  id: number,
  productType: MarkupProductType,
  status: MarkupConfigurationStatus,
) {
  return request<MarkupConfigurationRecord>(`/admin/markup-configurations/${id}/status?productType=${productType}`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  });
}

export function reorderMarkupConfigurations(productType: MarkupProductType, orderedIds: number[]) {
  return request<MarkupConfigurationRecord[]>('/admin/markup-configurations/reorder', {
    method: 'PATCH',
    body: JSON.stringify({ productType, orderedIds }),
  });
}

export function deleteMarkupConfiguration(id: number, productType: MarkupProductType) {
  return request<boolean>(`/admin/markup-configurations/${id}?productType=${productType}`, {
    method: 'DELETE',
  });
}
