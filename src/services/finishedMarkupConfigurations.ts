import { request } from './http';

export type FinishedMarkupConfigurationStatus = 'enabled' | 'disabled';
export interface FinishedMarkupConfigurationRecord {
  id: number;
  name: string;
  priceCoefficient: number;
  sortOrder: number;
  status: FinishedMarkupConfigurationStatus;
  createdByName?: string;
  createdByAccountId?: number;
  createdAt?: string;
  updatedAt?: string;
  referenced: boolean;
}
export interface FinishedMarkupConfigurationPayload {
  name: string;
  priceCoefficient: number;
}
export interface FinishedGuidePriceSettingRecord {
  id: number;
  priceCoefficient: number;
  updatedByName?: string;
  updatedByAccountId?: number;
  updatedAt?: string;
}

export const listFinishedMarkupConfigurations = () =>
  request<FinishedMarkupConfigurationRecord[]>('/admin/finished-markup-configurations');
export const listFinishedMarkupConfigurationOptions = () =>
  request<FinishedMarkupConfigurationRecord[]>('/admin/finished-markup-configurations/options');
export const createFinishedMarkupConfiguration = (payload: FinishedMarkupConfigurationPayload) =>
  request<FinishedMarkupConfigurationRecord>('/admin/finished-markup-configurations', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
export const updateFinishedMarkupConfiguration = (id: number, payload: FinishedMarkupConfigurationPayload) =>
  request<FinishedMarkupConfigurationRecord>(`/admin/finished-markup-configurations/${id}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
export const updateFinishedMarkupConfigurationStatus = (id: number, status: FinishedMarkupConfigurationStatus) =>
  request<FinishedMarkupConfigurationRecord>(`/admin/finished-markup-configurations/${id}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  });
export const reorderFinishedMarkupConfigurations = (orderedIds: number[]) =>
  request<FinishedMarkupConfigurationRecord[]>('/admin/finished-markup-configurations/reorder', {
    method: 'PATCH',
    body: JSON.stringify({ orderedIds }),
  });
export const deleteFinishedMarkupConfiguration = (id: number) =>
  request<boolean>(`/admin/finished-markup-configurations/${id}`, { method: 'DELETE' });
export const getFinishedGuidePriceSetting = () =>
  request<FinishedGuidePriceSettingRecord | null>('/admin/finished-guide-price-setting');
export const updateFinishedGuidePriceSetting = (priceCoefficient: number) =>
  request<FinishedGuidePriceSettingRecord>('/admin/finished-guide-price-setting', {
    method: 'PUT',
    body: JSON.stringify({ priceCoefficient }),
  });
