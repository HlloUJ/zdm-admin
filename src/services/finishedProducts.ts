import { request } from './http';
import type { ProductMarkupPriceSnapshot } from './slabs';

export type FinishedProductStatus = 'warehouse' | 'selling' | 'offShelf' | 'soldOut' | 'recycle';

export interface FinishedProductRecord {
  id: number;
  categoryId?: number;
  supplierId?: number;
  name: string;
  sku: string;
  coverImage?: string;
  publisherType?: string;
  totalStock?: number;
  guidePrice?: number;
  markupPrices?: ProductMarkupPriceSnapshot[];
  status?: FinishedProductStatus;
  createdAt?: string;
  updatedAt?: string;
}

export interface FinishedProductPayload {
  categoryId?: number;
  supplierId?: number;
  name: string;
  sku: string;
  coverImage?: string;
  publisherType?: string;
  totalStock?: number;
  guidePrice?: number;
  markupPrices?: ProductMarkupPriceSnapshot[];
  status: FinishedProductStatus;
}

export function listFinishedProducts() {
  return request<FinishedProductRecord[]>('/admin/finished-products');
}

export function createFinishedProduct(payload: FinishedProductPayload) {
  return request<FinishedProductRecord>('/admin/finished-products', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function updateFinishedProduct(id: number, payload: FinishedProductPayload) {
  return request<FinishedProductRecord>(`/admin/finished-products/${id}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
}

export function deleteFinishedProduct(id: number) {
  return request<boolean>(`/admin/finished-products/${id}`, {
    method: 'DELETE',
  });
}
