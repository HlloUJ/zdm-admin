import { request } from './http';

export interface MasterDataRecord {
  id: number;
  dataType: string;
  name: string;
  code: string;
  extra?: string;
  status?: 'enabled' | 'disabled';
  createdAt?: string;
  updatedAt?: string;
}

export interface MasterDataPayload {
  dataType: string;
  name: string;
  code: string;
  extra?: string;
  status: 'enabled' | 'disabled';
}

export function listMasterData() {
  return request<MasterDataRecord[]>('/admin/master-data');
}

export function createMasterData(payload: MasterDataPayload) {
  return request<MasterDataRecord>('/admin/master-data', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function updateMasterData(id: number, payload: MasterDataPayload) {
  return request<MasterDataRecord>(`/admin/master-data/${id}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
}
