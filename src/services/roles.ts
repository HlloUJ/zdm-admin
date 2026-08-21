import { request } from './http';

export interface RoleRecord {
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
  audience: 'admin' | 'store' | 'supplier';
  functionPermissions: string;
}

export interface RolePayload {
  name: string;
  code: string;
  dataScope: string;
  status: 'enabled' | 'disabled';
  remark?: string;
  functionPermissions?: string;
}

export function listRoles() {
  return request<RoleRecord[]>('/admin/roles');
}

export function getRolePermissionScope() {
  return request<RolePermissionScope>('/admin/roles/permission-scope');
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
