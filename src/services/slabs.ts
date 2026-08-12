import { request } from './http';

export type SlabStatus = 'warehouse' | 'selling' | 'offShelf' | 'soldOut' | 'recycle';

export interface SlabRecord {
  id: number;
  supplierId?: number;
  varietyId?: number;
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
  status?: SlabStatus;
  createdAt?: string;
  updatedAt?: string;
}

export interface SlabPayload {
  supplierId?: number;
  varietyId?: number;
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
  status: SlabStatus;
}

export function listSlabs() {
  return request<SlabRecord[]>('/admin/slabs');
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
