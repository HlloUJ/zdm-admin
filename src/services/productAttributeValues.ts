import { request } from './http';

export interface ProductAttributeValueRecord {
  id: number;
  attributeId: number;
  scope: 'shared' | 'finished' | 'accessory';
  value: string;
  code: string;
  status?: 'enabled' | 'disabled';
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

export function createProductAttributeValue(payload: ProductAttributeValuePayload) {
  return request<ProductAttributeValueRecord>('/admin/product-attribute-values', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function updateProductAttributeValue(id: number, payload: ProductAttributeValuePayload) {
  return request<ProductAttributeValueRecord>(`/admin/product-attribute-values/${id}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
}

export function deleteProductAttributeValue(id: number) {
  return request<boolean>(`/admin/product-attribute-values/${id}`, {
    method: 'DELETE',
  });
}
