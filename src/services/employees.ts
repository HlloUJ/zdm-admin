import { request } from './http';

export interface EmployeeRecord {
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
  inviterName?: string;
  invitedByName?: string;
  createdByName?: string;
  inviter?: string;
  createdBy?: string | number;
  createdAt?: string;
  updatedAt?: string;
}

export interface EmployeePayload {
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

export function listEmployees() {
  return request<EmployeeRecord[]>('/admin/employees');
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

export function deleteEmployee(id: number) {
  return request<boolean>(`/admin/employees/${id}`, {
    method: 'DELETE',
  });
}
