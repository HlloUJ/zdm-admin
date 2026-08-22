import { request } from './http';

export type SlabMarkupConfigurationStatus = 'enabled' | 'disabled';
export interface SlabMarkupConfigurationRecord {
  id: number;
  name: string;
  markupRate: number;
  sortOrder: number;
  status: SlabMarkupConfigurationStatus;
  createdByName?: string;
  createdByAccountId?: number;
  createdAt?: string;
  updatedAt?: string;
  referenced: boolean;
}
export interface SlabMarkupConfigurationPayload {
  name: string;
  markupRate: number;
}

export const listSlabMarkupConfigurations = () =>
  request<SlabMarkupConfigurationRecord[]>('/admin/slab-markup-configurations');
export const listSlabMarkupConfigurationOptions = () =>
  request<SlabMarkupConfigurationRecord[]>('/admin/slab-markup-configurations/options');
export const createSlabMarkupConfiguration = (payload: SlabMarkupConfigurationPayload) =>
  request<SlabMarkupConfigurationRecord>('/admin/slab-markup-configurations', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
export const updateSlabMarkupConfiguration = (id: number, payload: SlabMarkupConfigurationPayload) =>
  request<SlabMarkupConfigurationRecord>(`/admin/slab-markup-configurations/${id}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
export const updateSlabMarkupConfigurationStatus = (id: number, status: SlabMarkupConfigurationStatus) =>
  request<SlabMarkupConfigurationRecord>(`/admin/slab-markup-configurations/${id}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  });
export const reorderSlabMarkupConfigurations = (orderedIds: number[]) =>
  request<SlabMarkupConfigurationRecord[]>('/admin/slab-markup-configurations/reorder', {
    method: 'PATCH',
    body: JSON.stringify({ orderedIds }),
  });
export const deleteSlabMarkupConfiguration = (id: number) =>
  request<boolean>(`/admin/slab-markup-configurations/${id}`, { method: 'DELETE' });
