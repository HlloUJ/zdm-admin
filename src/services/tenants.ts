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

export interface TenantPurgePreview {
  eligible: boolean;
  tenantName: string;
  storeCount: number;
  employeeCount: number;
  roleCount: number;
  accountDeleteCount: number;
  accountRetainCount: number;
  blockers: string[];
}

export interface TenantPurgeResult {
  tenantDeleteCount: number;
  storeDeleteCount: number;
  employeeDeleteCount: number;
  roleDeleteCount: number;
  accountDeleteCount: number;
  accountRetainCount: number;
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

export function getTenantPurgePreview(id: number) {
  return request<TenantPurgePreview>(`/admin/tenants/${id}/purge-preview`);
}

export function purgeTenant(id: number, confirmationName: string) {
  return request<TenantPurgeResult>(`/admin/tenants/${id}/purge`, {
    method: 'POST',
    body: JSON.stringify({ confirmationName }),
  });
}
