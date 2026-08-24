import { request } from './http';

export type SlabMarkupConfigurationStatus = 'enabled' | 'disabled';
export interface SlabMarkupConfigurationRecord {
  id: number;
  name: string;
  priceCoefficient: number;
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
  priceCoefficient: number;
}
export interface SlabGuidePriceSettingRecord {
  id: number;
  priceCoefficient: number;
  updatedByName?: string;
  updatedByAccountId?: number;
  updatedAt?: string;
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
export const getSlabGuidePriceSetting = () =>
  request<SlabGuidePriceSettingRecord | null>('/admin/slab-guide-price-setting');
export const updateSlabGuidePriceSetting = (priceCoefficient: number) =>
  request<SlabGuidePriceSettingRecord>('/admin/slab-guide-price-setting', {
    method: 'PUT',
    body: JSON.stringify({ priceCoefficient }),
  });
