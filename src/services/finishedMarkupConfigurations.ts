import { request } from './http';

export type FinishedMarkupConfigurationStatus = 'enabled' | 'disabled';
export interface FinishedMarkupConfigurationRecord {
  id: number;
  name: string;
  markupRate: number;
  sortOrder: number;
  status: FinishedMarkupConfigurationStatus;
  createdByName?: string;
  createdByAccountId?: number;
  createdAt?: string;
  updatedAt?: string;
  referenced: boolean;
}
export interface FinishedMarkupConfigurationPayload { name: string; markupRate: number }

export const listFinishedMarkupConfigurations = () =>
  request<FinishedMarkupConfigurationRecord[]>('/admin/finished-markup-configurations');
export const listFinishedMarkupConfigurationOptions = () =>
  request<FinishedMarkupConfigurationRecord[]>('/admin/finished-markup-configurations/options');
export const createFinishedMarkupConfiguration = (payload: FinishedMarkupConfigurationPayload) =>
  request<FinishedMarkupConfigurationRecord>('/admin/finished-markup-configurations', {
    method: 'POST', body: JSON.stringify(payload),
  });
export const updateFinishedMarkupConfiguration = (id: number, payload: FinishedMarkupConfigurationPayload) =>
  request<FinishedMarkupConfigurationRecord>(`/admin/finished-markup-configurations/${id}`, {
    method: 'PUT', body: JSON.stringify(payload),
  });
export const updateFinishedMarkupConfigurationStatus = (id: number, status: FinishedMarkupConfigurationStatus) =>
  request<FinishedMarkupConfigurationRecord>(`/admin/finished-markup-configurations/${id}/status`, {
    method: 'PATCH', body: JSON.stringify({ status }),
  });
export const reorderFinishedMarkupConfigurations = (orderedIds: number[]) =>
  request<FinishedMarkupConfigurationRecord[]>('/admin/finished-markup-configurations/reorder', {
    method: 'PATCH', body: JSON.stringify({ orderedIds }),
  });
export const deleteFinishedMarkupConfiguration = (id: number) =>
  request<boolean>(`/admin/finished-markup-configurations/${id}`, { method: 'DELETE' });
