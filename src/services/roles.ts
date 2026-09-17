import { request } from './http';

export interface RoleRecord {
  createdByClientCode?: 'admin' | 'supply-chain' | null;
  clientCode?: 'admin' | 'supply-chain';
  id: number;
  tenantId?: number;
  storeId?: number;
  name: string;
  code: string;
  dataScope: string;
  status: 'enabled' | 'disabled';
  remark?: string;
  functionPermissions?: string;
  createdByName?: string;
  createdByAccountId?: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface RolePermissionScope {
  audience: 'admin' | 'store' | 'supplier' | 'supply-chain';
  functionPermissions: string;
}

export interface RolePayload {
  clientCode?: 'admin' | 'supply-chain';
  name: string;
  code: string;
  dataScope: string;
  status: 'enabled' | 'disabled';
  remark?: string;
  functionPermissions?: string;
}

export function listRoles(clientCode?: string) {
  return request<RoleRecord[]>(`/admin/roles${clientCode ? `?clientCode=${clientCode}` : ''}`);
}

export function getRolePermissionScope(clientCode?: string) {
  return request<RolePermissionScope>(`/admin/roles/permission-scope${clientCode ? `?clientCode=${clientCode}` : ''}`);
}

export function createRole(payload: RolePayload) {
  return request<RoleRecord>('/admin/roles', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function updateRole(id: number, payload: RolePayload) {
  return request<RoleRecord>(`/admin/roles/${id}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
}

export function deleteRole(id: number) {
  return request<boolean>(`/admin/roles/${id}`, {
    method: 'DELETE',
  });
}
