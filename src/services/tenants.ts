import { request } from './http';

export interface TenantRecord {
  id: number;
  name: string;
  contactName: string;
  contactPhone: string;
  status: 'enabled' | 'disabled';
  createdByName?: string;
  createdByAccountId?: number | null;
  businessTypes?: string;
  remark?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface TenantPayload {
  name: string;
  contactName: string;
  contactPhone: string;
  status: 'enabled' | 'disabled';
  businessTypes?: string;
  remark?: string;
}

export function listTenants() {
  return request<TenantRecord[]>('/admin/tenants');
}

export function createTenant(payload: TenantPayload) {
  return request<TenantRecord>('/admin/tenants', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function updateTenant(id: number, payload: TenantPayload) {
  return request<TenantRecord>(`/admin/tenants/${id}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
}

export function updateTenantBusinesses(id: number, businessTypes: string) {
  return request<TenantRecord>(`/admin/tenants/${id}/businesses`, {
    method: 'PATCH',
    body: JSON.stringify({ businessTypes }),
  });
}

export function updateTenantStatus(id: number, status: TenantRecord['status']) {
  return request<TenantRecord>(`/admin/tenants/${id}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  });
}

export function deleteTenant(id: number) {
  return request<boolean>(`/admin/tenants/${id}`, {
    method: 'DELETE',
  });
}
