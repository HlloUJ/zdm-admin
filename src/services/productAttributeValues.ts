import { request } from './http';
import type { ProductAttributeRecord } from './productAttributes';

export interface ProductAttributeValueRecord {
  id: number;
  attributeId: number;
  scope: 'shared' | 'finished' | 'accessory';
  value: string;
  code: string;
  status?: 'enabled' | 'disabled';
  createdByName?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface ProductAttributeValuePayload {
  attributeId: number;
  scope: 'shared' | 'finished' | 'accessory';
  value: string;
  code: string;
  status: 'enabled' | 'disabled';
}

export function listProductAttributeValues() {
  return request<ProductAttributeValueRecord[]>('/admin/product-attribute-values');
}

export function listProductAttributeValueOptions() {
  return request<ProductAttributeRecord[]>('/admin/product-attribute-values/attribute-options');
}

export function createProductAttributeValue(payload: ProductAttributeValuePayload) {
  return request<ProductAttributeValueRecord>('/admin/product-attribute-values', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function updateProductAttributeValueStatus(id: number, status: 'enabled' | 'disabled') {
  return request<ProductAttributeValueRecord>(`/admin/product-attribute-values/${id}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  });
}

export function deleteProductAttributeValue(id: number) {
  return request<boolean>(`/admin/product-attribute-values/${id}`, {
    method: 'DELETE',
  });
}
