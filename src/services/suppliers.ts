import { request } from './http';

export interface SupplierRecord {
  id: number;
  name: string;
  type: 'slab' | 'finished' | 'accessory';
  contactName?: string;
  contactPhone?: string;
  region?: string;
  address?: string;
  qualificationStatus?: string;
  createdByName?: string;
  remark?: string;
  status?: 'enabled' | 'disabled';
  createdAt?: string;
  updatedAt?: string;
}

export interface SupplierPayload {
  name: string;
  type: 'slab' | 'finished' | 'accessory';
  contactName?: string;
  contactPhone?: string;
  region?: string;
  address?: string;
  qualificationStatus?: string;
  remark?: string;
  status: 'enabled' | 'disabled';
}

export function listSuppliers() {
  return request<SupplierRecord[]>('/admin/suppliers');
}

export function createSupplier(payload: SupplierPayload) {
  return request<SupplierRecord>('/admin/suppliers', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function updateSupplier(id: number, payload: SupplierPayload) {
  return request<SupplierRecord>(`/admin/suppliers/${id}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
}

export function updateSupplierStatus(id: number, status: SupplierPayload['status']) {
  return request<SupplierRecord>(`/admin/suppliers/${id}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  });
}

export function deleteSupplier(id: number) {
  return request<boolean>(`/admin/suppliers/${id}`, {
    method: 'DELETE',
  });
}
