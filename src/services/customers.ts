import { request, getAuthToken, ApiError } from './http';
export type CustomerStatus = 'daily' | 'archived';
export interface CustomerProfile {
  name: string;
  phone: string;
  wechat: string;
  requirement: string;
  remark: string;
}
export interface Customer extends CustomerProfile {
  id: number;
  tenantId: number;
  storeId: number;
  ownerAccountId: number;
  ownerName: string;
  createdByAccountId: number;
  createdByName: string;
  status: CustomerStatus;
  archivedAt?: string;
  createdAt: string;
  lastFollowedAt?: string;
  nextFollowAt?: string;
}
export interface Attachment {
  mediaId: number;
  name: string;
  mediaType: string;
  mimeType: string;
  size: number;
}
export interface Followup {
  id: number;
  followedAt: string;
  content: string;
  nextFollowAt?: string;
  nextFollowTask: string;
  createdByAccountId: number;
  createdByName: string;
  createdAt: string;
  attachments: Attachment[];
}
export interface CustomerDetail {
  customer: Customer;
  followups: Followup[];
}
export interface Owner {
  accountId: number;
  name: string;
  active: boolean;
}
export interface FollowupPayload {
  followedAt: string;
  content: string;
  nextFollowAt: string | null;
  nextFollowTask: string;
  mediaIds: number[];
}
export type CustomerAction = 'assign' | 'archive' | 'restore' | 'purge';
const base = '/admin/store-customers';
export const listCustomers = (status: CustomerStatus, name = '', phone = '', ownerAccountId?: number) => {
  const query = new URLSearchParams({ status, name, phone });
  if (ownerAccountId != null) query.set('ownerAccountId', String(ownerAccountId));
  return request<Customer[]>(`${base}?${query}`);
};
export const listCustomerOwners = (status: CustomerStatus) => request<Owner[]>(`${base}/owners?status=${status}`);
export const getCustomerDetail = (id: number) => request<CustomerDetail>(`${base}/${id}`);
export const saveCustomer = (payload: CustomerProfile, id?: number) =>
  request<Customer>(id ? `${base}/${id}` : base, { method: id ? 'PUT' : 'POST', body: JSON.stringify(payload) });
export const actOnCustomers = (
  ids: number[],
  status: CustomerStatus,
  action: CustomerAction,
  batch: boolean,
  ownerAccountId?: number,
) =>
  request<boolean>(`${base}/${batch ? 'batch' : 'action'}`, {
    method: 'POST',
    body: JSON.stringify({ ids, status, action, ownerAccountId }),
  });
export const saveFollowup = (customerId: number, payload: FollowupPayload, id?: number) =>
  request<boolean>(`${base}/${customerId}/followups${id ? `/${id}` : ''}`, {
    method: id ? 'PUT' : 'POST',
    body: JSON.stringify(payload),
  });
export const deleteFollowup = (customerId: number, id: number) =>
  request<boolean>(`${base}/${customerId}/followups/${id}`, { method: 'DELETE' });
export const uploadAttachment = async (customerId: number, file: File) => {
  if (file.size > 5 * 1024 * 1024) throw new Error('附件不能超过5MiB');
  const body = new FormData();
  body.append('file', file);
  return request<{ id: number; mediaType: string; mimeType: string }>(`${base}/${customerId}/attachments`, {
    method: 'POST',
    body,
  });
};
export const releaseAttachment = (customerId: number, mediaId: number) =>
  request<boolean>(`${base}/${customerId}/attachments/${mediaId}`, { method: 'DELETE' });
export const loadAttachment = async (customerId: number, followupId: number, mediaId: number) => {
  const response = await fetch(`/api${base}/${customerId}/followups/${followupId}/attachments/${mediaId}`, {
    headers: { Authorization: `Bearer ${getAuthToken()}` },
  });
  if (!response.ok) throw new ApiError('附件读取失败', response.status);
  return response.blob();
};
