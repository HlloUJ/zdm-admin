import { request } from './http';

export interface ProductAttributeRecord {
  id: number;
  scope: 'shared' | 'finished' | 'accessory';
  name: string;
  valueType: 'select' | 'number' | 'text';
  attributeRole?: string;
  templateCount?: number;
  status?: 'enabled' | 'disabled';
  createdByName?: string;
  createdByAccountId?: number;
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

export interface ProductAttributeDeletePreview {
  deletionMode: 'physical' | 'business' | 'blocked';
  attributeValueCount: number;
  unfinishedProductCount: number;
  soldOutProductCount: number;
  templateScopes: Array<'finished' | 'accessory'>;
  message?: string;
}

export interface ProductAttributeDeleteResult {
  deletionMode: 'physical' | 'business';
  attributeValueCount: number;
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

export function updateProductAttributeStatus(id: number, status: ProductAttributePayload['status']) {
  return request<ProductAttributeRecord>(`/admin/product-attributes/${id}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  });
}

export function previewProductAttributeDelete(id: number) {
  return request<ProductAttributeDeletePreview>(`/admin/product-attributes/${id}/delete-preview`);
}

export function deleteProductAttribute(id: number) {
  return request<ProductAttributeDeleteResult>(`/admin/product-attributes/${id}`, {
    method: 'DELETE',
  });
}
