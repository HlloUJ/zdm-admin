import { request } from './http';
export interface StorePaymentNameOption {
  id: string;
  name: string;
  version: number;
}
export interface StorePaymentName extends StorePaymentNameOption {
  enabled: boolean;
  createdBy: number | null;
  createdByName: string | null;
  createdAt: string;
  updatedAt: string;
}
export interface StorePaymentNamePage {
  items: StorePaymentName[];
  total: number;
}
const base = '/store/payment-names';
export const listStorePaymentNames = (page = 1, pageSize = 10) =>
  request<StorePaymentNamePage>(`${base}?page=${page}&pageSize=${pageSize}`);
export const listStorePaymentNameOptions = () => request<StorePaymentNameOption[]>(`${base}/options`);
export const createStorePaymentName = (name: string) =>
  request<StorePaymentName>(base, { method: 'POST', body: JSON.stringify({ name }) });
export const updateStorePaymentName = (id: string, name: string, version: number) =>
  request<StorePaymentName>(`${base}/${id}`, { method: 'PUT', body: JSON.stringify({ name, version }) });
export const setStorePaymentNameStatus = (id: string, enabled: boolean, version: number) =>
  request<StorePaymentName>(`${base}/${id}/status`, { method: 'PUT', body: JSON.stringify({ enabled, version }) });
export const deleteStorePaymentName = (id: string, version: number) =>
  request<void>(`${base}/${id}?version=${version}`, { method: 'DELETE' });
