import { request } from './http';

export type SlabStatus = 'warehouse' | 'selling' | 'offShelf' | 'soldOut' | 'recycle';

export interface ProductMarkupPriceSnapshot {
  markupConfigurationId: number;
  currentName?: string;
  markupNameSnapshot?: string;
  markupRateSnapshot: number;
  costPriceSnapshot: number;
  salePrice: number;
  variantKey?: string;
  variantLabel?: string;
}

export interface SlabRecord {
  id: number;
  supplierId?: number;
  varietyId?: number;
  textureId?: number;
  colorId?: number;
  gradeId?: number;
  name: string;
  serialNo: string;
  warehouse?: string;
  publisherType?: string;
  lengthMm?: number;
  widthMm?: number;
  thicknessMm?: number;
  areaSquareMeter?: number;
  costPrice?: number;
  guidePrice?: number;
  markupPrices?: ProductMarkupPriceSnapshot[];
  status?: SlabStatus;
  createdAt?: string;
  updatedAt?: string;
}

export interface SlabPayload {
  supplierId?: number;
  varietyId?: number;
  textureId?: number;
  colorId?: number;
  gradeId?: number;
  name: string;
  serialNo: string;
  warehouse?: string;
  publisherType?: string;
  lengthMm?: number;
  widthMm?: number;
  thicknessMm?: number;
  areaSquareMeter?: number;
  costPrice?: number;
  guidePrice?: number;
  markupPrices?: ProductMarkupPriceSnapshot[];
  status: SlabStatus;
}

export interface SlabPublishOption {
  id: number;
  label: string;
  description?: string;
  status: 'enabled' | 'disabled';
}

export interface SlabPublishColorCategoryOption extends SlabPublishOption {
  children: SlabPublishOption[];
}

export interface SlabPublishOptions {
  textures: SlabPublishOption[];
  colorCategories: SlabPublishColorCategoryOption[];
  grades: SlabPublishOption[];
}

export function listSlabs() {
  return request<SlabRecord[]>('/admin/slabs');
}

export function getSlabPublishOptions() {
  return request<SlabPublishOptions>('/admin/slabs/publish-options');
}

export function createSlab(payload: SlabPayload) {
  return request<SlabRecord>('/admin/slabs', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function updateSlab(id: number, payload: SlabPayload) {
  return request<SlabRecord>(`/admin/slabs/${id}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
}

export function deleteSlab(id: number) {
  return request<boolean>(`/admin/slabs/${id}`, {
    method: 'DELETE',
  });
}
