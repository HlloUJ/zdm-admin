import { request } from './http';

export interface SlabTextureRecord {
  id: number;
  name: string;
  createdByName?: string;
  createdByAccountId?: number;
  remark?: string;
  status?: 'enabled' | 'disabled';
  createdAt?: string;
}

export interface SlabTextureAliasRecord {
  id: number;
  textureId: number;
  name: string;
  createdAt?: string;
}

export interface SlabTexturePayload {
  name: string;
  remark?: string;
  status: 'enabled' | 'disabled';
}

export const listSlabTextures = () => request<SlabTextureRecord[]>('/admin/slab-textures');
export const createSlabTexture = (payload: SlabTexturePayload) =>
  request<SlabTextureRecord>('/admin/slab-textures', { method: 'POST', body: JSON.stringify(payload) });
export const updateSlabTexture = (id: number, payload: SlabTexturePayload) =>
  request<SlabTextureRecord>(`/admin/slab-textures/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
export const updateSlabTextureStatus = (id: number, status: SlabTexturePayload['status']) =>
  request<SlabTextureRecord>(`/admin/slab-textures/${id}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  });
export const deleteSlabTexture = (id: number) => request<boolean>(`/admin/slab-textures/${id}`, { method: 'DELETE' });
export const listSlabTextureAliases = (textureId: number) =>
  request<SlabTextureAliasRecord[]>(`/admin/slab-textures/${textureId}/aliases`);
export const createSlabTextureAlias = (textureId: number, name: string) =>
  request<SlabTextureAliasRecord>(`/admin/slab-textures/${textureId}/aliases`, {
    method: 'POST',
    body: JSON.stringify({ name }),
  });
export const updateSlabTextureAlias = (textureId: number, aliasId: number, name: string) =>
  request<SlabTextureAliasRecord>(`/admin/slab-textures/${textureId}/aliases/${aliasId}`, {
    method: 'PUT',
    body: JSON.stringify({ name }),
  });
export const deleteSlabTextureAlias = (textureId: number, aliasId: number) =>
  request<boolean>(`/admin/slab-textures/${textureId}/aliases/${aliasId}`, { method: 'DELETE' });
