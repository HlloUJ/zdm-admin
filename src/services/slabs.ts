import { request } from './http';
import { releaseTemporaryMedia, uploadMedia, type MediaResource } from './media';

export type SlabStatus = 'warehouse' | 'selling' | 'offShelf' | 'soldOut' | 'recycle';
export type SlabPublishTargetStatus = Extract<SlabStatus, 'warehouse' | 'selling'>;
export type SlabPublisherType = '平台发布' | '接口获取';
export interface SlabPrice {
  markupConfigurationId: number;
  priceCoefficient: number;
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
  guidePriceCoefficient?: number;
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
  guidePriceCoefficient?: number;
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
  varieties: SlabPublishOption[];
  origins: SlabPublishOption[];
  textures: SlabPublishOption[];
  colorCategories: SlabPublishColorCategoryOption[];
  grades: SlabPublishOption[];
  suppliers: SlabPublishOption[];
}

export type SlabOperationType =
  | 'CREATE'
  | 'UPDATE'
  | 'PRICE_UPDATE'
  | 'SHELF'
  | 'OFF_SHELF'
  | 'RESTORE_WAREHOUSE'
  | 'RESTORE_RECYCLE'
  | 'DELETE_TO_RECYCLE'
  | 'PHYSICAL_DELETE'
  | 'PURGE'
  | 'STATUS_UPDATE';

export interface SlabOperationChange {
  before?: unknown;
  after?: unknown;
}

export interface SlabOperationLogRecord {
  id: number;
  slabId: number;
  slabSerialNo: string;
  slabName: string;
  publisherType: SlabPublisherType;
  operationType: SlabOperationType;
  operationSummary: string;
  beforeStatus?: SlabStatus;
  afterStatus?: SlabStatus;
  standardReason?: string;
  detailReason?: string;
  changeDetails?: string;
  operationSource: 'MANUAL' | 'EXTERNAL_API' | 'SYSTEM';
  batchNo?: string;
  operatorName: string;
  operatorAccountId?: number;
  operatedAt: string;
}

export interface SlabOperationLogPage {
  records: SlabOperationLogRecord[];
  total: number;
  page: number;
  pageSize: number;
}

export interface SlabOperationLogQuery {
  keyword?: string;
  operationType?: SlabOperationType | '';
  operatorName?: string;
  startDate?: string;
  endDate?: string;
  page?: number;
  pageSize?: number;
}

export function resolveSlabPublishTargetStatus(activeStatus: SlabStatus): SlabPublishTargetStatus {
  return activeStatus === 'selling' ? 'selling' : 'warehouse';
}

export function listSlabs() {
  return request<SlabRecord[]>('/admin/slabs');
}

export function getSlabPublishOptions() {
  return request<SlabPublishOptions>('/admin/slabs/form-options');
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

export function removeSlab(id: number, payload: { reason?: string; detail?: string } = {}) {
  return request<boolean>(`/admin/slabs/${id}/delete`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function listSlabOperationLogs(query: SlabOperationLogQuery = {}) {
  const search = new URLSearchParams();
  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined && value !== '') search.set(key, String(value));
  });
  const queryString = search.toString();
  const suffix = queryString ? `?${queryString}` : '';
  return request<SlabOperationLogPage>(`/admin/slabs/operation-logs${suffix}`);
}

export function deleteSlab(id: number) {
  return request<boolean>(`/admin/slabs/${id}`, {
    method: 'DELETE',
  });
}

export function deleteSlabs(ids: number[]) {
  return request<boolean>('/admin/slabs/batch-purge', {
    method: 'DELETE',
    body: JSON.stringify(ids),
  });
}

export function clearRecycleSlabs() {
  return request<number>('/admin/slabs/clear-recycle', {
    method: 'DELETE',
  });
}
