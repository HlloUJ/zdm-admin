import { request } from './http';

export interface SlabMarkupConfigurationRecord {
  id: number;
  storeLevelId: number;
  name: string;
  priceCoefficient: number;
  sortOrder: number;
  createdByName?: string;
  createdByAccountId?: number;
  createdAt?: string;
  updatedAt?: string;
}
export interface SlabMarkupConfigurationPayload {
  storeLevelId: number;
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
export const deleteSlabMarkupConfiguration = (id: number) =>
  request<boolean>(`/admin/slab-markup-configurations/${id}`, { method: 'DELETE' });
export const getSlabGuidePriceSetting = () =>
  request<SlabGuidePriceSettingRecord | null>('/admin/slab-guide-price-setting');
export const updateSlabGuidePriceSetting = (priceCoefficient: number) =>
  request<SlabGuidePriceSettingRecord>('/admin/slab-guide-price-setting', {
    method: 'PUT',
    body: JSON.stringify({ priceCoefficient }),
  });
