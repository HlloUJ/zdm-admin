import { request } from './http';
import { releaseTemporaryMedia, uploadMedia, type MediaResource } from './media';

export type SlabStatus = 'pendingReview' | 'warehouse' | 'selling' | 'offShelf' | 'soldOut' | 'recycle' | 'rejected';
export type SlabPublishTargetStatus = Extract<SlabStatus, 'warehouse' | 'selling'>;
export type SlabPublisherType = '平台发布' | '接口获取';
export interface SlabPrice {
  markupConfigurationId: number;
  markupRate: number;
  costPrice: number;
  price: number;
}

export interface SlabOffShelfRecord {
  id: number;
  slabId: number;
  standardReason: string;
  detailReason?: string;
  offShelvedAt: string;
  offShelvedByName: string;
  offShelvedByAccountId?: number;
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
  mainImageMediaId?: number;
  scanImageMediaId?: number;
  designImageMediaId?: number;
  videoMediaId?: number;
  videoCoverMediaId?: number;
  mainImageUrl?: string;
  scanImageUrl?: string;
  designImageUrl?: string;
  videoUrl?: string;
  videoCoverUrl?: string;
  createdByName?: string;
  createdByAccountId?: number;
  rejectionReason?: string;
  rejectionDetail?: string;
  rejectedByName?: string;
  rejectedByAccountId?: number;
  rejectedAt?: string;
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
  offShelfRecords?: SlabOffShelfRecord[];
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
  mainImageMediaId?: number;
  scanImageMediaId?: number;
  designImageMediaId?: number;
  videoMediaId?: number;
  videoCoverMediaId?: number;
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

export function resolveSlabPublishTargetStatus(activeStatus: SlabStatus): SlabPublishTargetStatus {
  return activeStatus === 'selling' ? 'selling' : 'warehouse';
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
  return uploadMedia('/admin/slabs/images', file);
}

export function releaseTemporarySlabMedia(mediaId: MediaResource['id']) {
  return releaseTemporaryMedia('/admin/slabs/images', mediaId);
}

export function updateSlab(id: number, payload: SlabPayload) {
  return request<SlabRecord>(`/admin/slabs/${id}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
}

export function updateSlabStatuses(ids: number[], status: SlabStatus, reason?: string, detail?: string) {
  return request<boolean>('/admin/slabs/batch-status', {
    method: 'PUT',
    body: JSON.stringify({ ids, status, reason, detail }),
  });
}

export function rejectSlab(id: number, payload: { reason: string; detail: string }) {
  return request<SlabRecord>(`/admin/slabs/${id}/reject`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
}

export function deleteSlab(id: number) {
  return request<boolean>(`/admin/slabs/${id}`, {
    method: 'DELETE',
  });
}
