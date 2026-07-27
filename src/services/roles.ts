import { request } from './http';

export interface RoleRecord {
  id: number;
  name: string;
  code: string;
  category?: 'partner-store' | 'supplier-store' | 'operation-platform';
  clientCode?: string;
  dataScope: string;
  status: 'enabled' | 'disabled';
  remark?: string;
  functionPermissions?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface RolePayload {
  name: string;
  code: string;
  category: 'partner-store' | 'supplier-store' | 'operation-platform';
  clientCode: string;
  dataScope: string;
  status: 'enabled' | 'disabled';
  remark?: string;
  functionPermissions?: string;
}

export function listRoles() {
  return request<RoleRecord[]>('/admin/roles');
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
