import { request } from './http';

export interface SupplierRecord {
  id: number;
  name: string;
  ownerScope?: 'platform' | 'store';
  tenantId?: number;
  storeId?: number;
  supplyTypeIds: number[];
  supplyTypes: SupplierSupplyTypeRecord[];
  contactName?: string;
  contactPhone?: string;
  region?: string;
  address?: string;
  qualificationStatus?: string;
  createdByName?: string;
  createdByAccountId?: number;
  remark?: string;
  status?: 'enabled' | 'disabled';
  createdAt?: string;
  updatedAt?: string;
}

export interface SupplierPayload {
  name: string;
  supplyTypeIds: number[];
  contactName?: string;
  contactPhone?: string;
  region?: string;
  address?: string;
  qualificationStatus?: string;
  remark?: string;
  status: 'enabled' | 'disabled';
}

export interface SupplierSupplyTypeRecord {
  id: number;
  code: string;
  name: string;
  status: 'enabled' | 'disabled';
  createdByName?: string;
  createdByAccountId?: number;
  referenced: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface SupplierSupplyTypePayload {
  name: string;
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

export function listSupplierSupplyTypes() {
  return request<SupplierSupplyTypeRecord[]>('/admin/supplier-supply-types');
}

export function createSupplierSupplyType(payload: SupplierSupplyTypePayload) {
  return request<SupplierSupplyTypeRecord>('/admin/supplier-supply-types', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function updateSupplierSupplyType(id: number, payload: SupplierSupplyTypePayload) {
  return request<SupplierSupplyTypeRecord>(`/admin/supplier-supply-types/${id}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
}

export function updateSupplierSupplyTypeStatus(id: number, status: SupplierSupplyTypeRecord['status']) {
  return request<SupplierSupplyTypeRecord>(`/admin/supplier-supply-types/${id}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  });
}

export function deleteSupplierSupplyType(id: number) {
  return request<boolean>(`/admin/supplier-supply-types/${id}`, {
    method: 'DELETE',
  });
}
