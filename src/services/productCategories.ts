import { request } from './http';

export interface ProductCategoryRecord {
  id: number;
  tenantId?: number;
  parentId?: number;
  scope: 'finished' | 'accessory';
  name: string;
  sortOrder?: number;
  productCount?: number;
  status?: 'enabled' | 'disabled';
  createdByName?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface ProductCategoryPayload {
  tenantId?: number;
  parentId?: number;
  scope: 'finished' | 'accessory';
  name: string;
  sortOrder?: number;
  productCount?: number;
  status: 'enabled' | 'disabled';
}

export function listProductCategories() {
  return request<ProductCategoryRecord[]>('/admin/product-categories');
}

export function createProductCategory(payload: ProductCategoryPayload) {
  return request<ProductCategoryRecord>('/admin/product-categories', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function updateProductCategory(id: number, payload: ProductCategoryPayload) {
  return request<ProductCategoryRecord>(`/admin/product-categories/${id}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
}

export function deleteProductCategory(id: number) {
  return request<boolean>(`/admin/product-categories/${id}`, {
    method: 'DELETE',
  });
}
