import { request } from './http';

export interface EmployeeRecord {
  clientCode?: 'admin' | 'supply-chain';
  id: number;
  tenantId?: number;
  storeId?: number;
  name: string;
  gender?: 'male' | 'female';
  phone: string;
  status: 'enabled' | 'disabled';
  roleIds?: string;
  dataPermission?: 'self' | 'all';
  remark?: string;
  createdByName?: string;
  createdByAccountId?: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface EmployeePayload {
  clientCode?: 'admin' | 'supply-chain';
  tenantId?: number;
  storeId?: number;
  name: string;
  gender?: 'male' | 'female';
  phone: string;
  status: 'enabled' | 'disabled';
  roleIds?: string;
  dataPermission?: 'self' | 'all';
  remark?: string;
}

export interface EmployeePermissionPayload {
  roleIds: string;
  dataPermission: 'self' | 'all';
}

export function listEmployees(clientCode?: string) {
  return request<EmployeeRecord[]>(`/admin/employees${clientCode ? `?clientCode=${clientCode}` : ''}`);
}

export function createEmployee(payload: EmployeePayload) {
  return request<EmployeeRecord>('/admin/employees', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function updateEmployee(id: number, payload: EmployeePayload) {
  return request<EmployeeRecord>(`/admin/employees/${id}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
}

export function updateEmployeePermissions(id: number, payload: EmployeePermissionPayload) {
  return request<EmployeeRecord>(`/admin/employees/${id}/permissions`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export function deleteEmployee(id: number) {
  return request<boolean>(`/admin/employees/${id}`, {
    method: 'DELETE',
  });
}
