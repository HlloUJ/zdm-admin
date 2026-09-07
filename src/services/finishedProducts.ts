import { request } from './http';
import { releaseTemporaryMedia, uploadMedia, type MediaResource } from './media';

export type FinishedProductStatus = 'warehouse' | 'selling' | 'offShelf' | 'soldOut' | 'recycle';

export interface FinishedProductPrice {
  storeLevelId: number;
  storeLevelName?: string;
  priceCoefficient: number;
  costPrice: number;
  price: number;
  variantKey: string;
  variantLabel?: string;
}
export interface FinishedProductGuidePrice {
  priceCoefficient: number;
  costPrice: number;
  price: number;
  variantKey: string;
  variantLabel?: string;
}

export interface FinishedProductAttributeEntry {
  id?: number;
  attributeId: number;
  attributeName: string;
  value: string;
}

export interface FinishedProductVariant {
  id?: number;
  variantKey: string;
  variantLabel: string;
  displayMode: 'single' | 'layered';
  salesAttributes?: Record<string, string>;
  material?: string;
  lengthValue?: string;
  color?: string;
  sizeValue?: string;
  stock: number;
}

export interface FinishedProductRecord {
  id: number;
  categoryId?: number;
  supplierId?: number;
  name: string;
  sku: string;
  mainImageMediaId?: number;
  mainImageMediaIds?: number[];
  mainImageUrls?: string[];
  videoMediaId?: number;
  mainImageUrl?: string;
  videoUrl?: string;
  coverImage?: string;
  detail?: string;
  publisherType?: string;
  totalStock?: number;
  guidePrice?: number;
  guidePrices?: FinishedProductGuidePrice[];
  markupPrices?: FinishedProductPrice[];
  attributes?: FinishedProductAttributeEntry[];
  variants?: FinishedProductVariant[];
  offShelfReason?: string;
  createdByName?: string;
  createdByAccountId?: number;
  status?: FinishedProductStatus;
  createdAt?: string;
  updatedAt?: string;
}

export interface FinishedProductPayload {
  categoryId?: number;
  supplierId?: number;
  name: string;
  sku: string;
  mainImageMediaId: number;
  mainImageMediaIds?: number[];
  videoMediaId: number;
  detail: string;
  totalStock?: number;
  guidePrice?: number;
  guidePrices?: FinishedProductGuidePrice[];
  markupPrices?: FinishedProductPrice[];
  attributes: FinishedProductAttributeEntry[];
  variants: FinishedProductVariant[];
  offShelfReason?: string;
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

export function uploadFinishedProductMedia(file: File) {
  return uploadMedia('/admin/finished-products/media', file);
}

export function releaseTemporaryFinishedProductMedia(mediaId: MediaResource['id']) {
  return releaseTemporaryMedia('/admin/finished-products/media', mediaId);
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

export interface FinishedProductPriceLevelOption {
  id: number;
  name: string;
  sortOrder?: number;
}
export const listFinishedProductPriceLevelOptions = () =>
  request<FinishedProductPriceLevelOption[]>('/admin/finished-products/price-level-options');
