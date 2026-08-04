import { request } from './http';

export interface ProductAttributeRecord {
  id: number;
  scope: 'shared' | 'finished' | 'accessory';
  name: string;
  valueType: 'select' | 'number' | 'text';
  attributeRole?: string;
  templateCount?: number;
  status?: 'enabled' | 'disabled';
  createdAt?: string;
  updatedAt?: string;
}

export interface ProductAttributePayload {
  scope: 'shared' | 'finished' | 'accessory';
  name: string;
  valueType: 'select' | 'number' | 'text';
  attributeRole?: string;
  status: 'enabled' | 'disabled';
}

export function listProductAttributes() {
  return request<ProductAttributeRecord[]>('/admin/product-attributes');
}

export function createProductAttribute(payload: ProductAttributePayload) {
  return request<ProductAttributeRecord>('/admin/product-attributes', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function updateProductAttribute(id: number, payload: ProductAttributePayload) {
  return request<ProductAttributeRecord>(`/admin/product-attributes/${id}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
}

export function deleteProductAttribute(id: number) {
  return request<boolean>(`/admin/product-attributes/${id}`, {
    method: 'DELETE',
  });
}
