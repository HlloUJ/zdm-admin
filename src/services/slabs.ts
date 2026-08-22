import { request } from './http';

export type SlabStatus = 'warehouse' | 'selling' | 'offShelf' | 'soldOut' | 'recycle';
export type SlabPublisherType = '平台发布' | '接口获取';
export interface SlabPrice {
  markupConfigurationId: number;
  markupRate: number;
  costPrice: number;
  price: number;
}

export interface SlabRecord {
  id: number;
  supplierId?: number;
  varietyId?: number;
  originId?: number;
  textureId?: number;
  colorId?: number;
  gradeId?: number;
  name: string;
  serialNo: string;
  warehouse?: string;
  publisherType?: SlabPublisherType;
  mainImageUrl?: string;
  scanImageUrl?: string;
  designImageUrl?: string;
  videoUrl?: string;
  videoCoverUrl?: string;
  createdByName?: string;
  createdByAccountId?: number;
  originName?: string;
  varietyName?: string;
  supplierName?: string;
  lengthMm?: number;
  widthMm?: number;
  thicknessMm?: number;
  toleranceMm?: number;
  corner1LengthMm?: number;
  corner1WidthMm?: number;
  corner2LengthMm?: number;
  corner2WidthMm?: number;
  corner3LengthMm?: number;
  corner3WidthMm?: number;
  corner4LengthMm?: number;
  corner4WidthMm?: number;
  areaSquareMeter?: number;
  costPrice?: number;
  guidePrice?: number;
  markupPrices?: SlabPrice[];
  status?: SlabStatus;
  createdAt?: string;
  updatedAt?: string;
}

export interface SlabPayload {
  supplierId?: number;
  varietyId?: number;
  originId?: number;
  textureId?: number;
  colorId?: number;
  gradeId?: number;
  name: string;
  serialNo: string;
  warehouse?: string;
  publisherType?: SlabPublisherType;
  mainImageUrl?: string;
  scanImageUrl?: string;
  designImageUrl?: string;
  videoUrl?: string;
  videoCoverUrl?: string;
  lengthMm?: number;
  widthMm?: number;
  thicknessMm?: number;
  toleranceMm?: number;
  corner1LengthMm?: number;
  corner1WidthMm?: number;
  corner2LengthMm?: number;
  corner2WidthMm?: number;
  corner3LengthMm?: number;
  corner3WidthMm?: number;
  corner4LengthMm?: number;
  corner4WidthMm?: number;
  areaSquareMeter?: number;
  costPrice?: number;
  guidePrice?: number;
  markupPrices?: SlabPrice[];
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

export function uploadSlabImage(file: File) {
  const body = new FormData();
  body.append('file', file);
  return request<{ url: string }>('/admin/slabs/images', {
    method: 'POST',
    body,
  });
}

export function deleteUnreferencedSlabImage(url: string) {
  return request<boolean>(`/admin/slabs/images?url=${encodeURIComponent(url)}`, {
    method: 'DELETE',
  });
}

export function updateSlab(id: number, payload: SlabPayload) {
  return request<SlabRecord>(`/admin/slabs/${id}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
}

export function updateSlabStatuses(ids: number[], status: SlabStatus) {
  return request<boolean>('/admin/slabs/batch-status', {
    method: 'PUT',
    body: JSON.stringify({ ids, status }),
  });
}

export function deleteSlab(id: number) {
  return request<boolean>(`/admin/slabs/${id}`, {
    method: 'DELETE',
  });
}
