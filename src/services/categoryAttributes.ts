import { request } from './http';

export interface CategoryAttributeRecord {
  id: number;
  categoryId: number;
  attributeId: number;
  requiredFlag?: boolean;
  skuFlag?: boolean;
  sortOrder?: number;
  status?: 'enabled' | 'disabled';
  createdAt?: string;
  updatedAt?: string;
}

export interface CategoryAttributePayload {
  categoryId: number;
  attributeId: number;
  requiredFlag?: boolean;
  skuFlag?: boolean;
  sortOrder?: number;
  status: 'enabled' | 'disabled';
}

export function listCategoryAttributes() {
  return request<CategoryAttributeRecord[]>('/admin/category-attributes');
}

export function createCategoryAttribute(payload: CategoryAttributePayload) {
  return request<CategoryAttributeRecord>('/admin/category-attributes', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function updateCategoryAttribute(id: number, payload: CategoryAttributePayload) {
  return request<CategoryAttributeRecord>(`/admin/category-attributes/${id}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
}

export function deleteCategoryAttribute(id: number) {
  return request<boolean>(`/admin/category-attributes/${id}`, {
    method: 'DELETE',
  });
}
