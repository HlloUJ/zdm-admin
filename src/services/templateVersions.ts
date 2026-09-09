import { request } from './http';
import type { ProductAttributeRecord } from './productAttributes';
import type { ProductAttributeValueRecord } from './productAttributeValues';
import type { ProductCategoryRecord } from './productCategories';

export type TemplateScope = 'finished' | 'accessory';
export interface TemplateAttribute {
  attributeId: number;
  name: string;
  scope: string;
  valueType: string;
  attributeRole: '' | 'product' | 'sales';
  requiredFlag: boolean;
  skuFlag: boolean;
  sortOrder: number;
  options: { id: number; value: string; code: string }[];
}
export interface TemplateVersion {
  id: number;
  categoryId: number;
  versionNo: number | null;
  state: 'draft' | 'published';
  revision: number;
  content: TemplateAttribute[];
  createdByName: string;
  publishedByName: string | null;
  changeNote: string;
  createdAt: string;
  publishedAt: string | null;
}
const root = '/admin/template-versions';
export const listTemplateCategories = (scope: TemplateScope) =>
  request<ProductCategoryRecord[]>(`${root}/categories?scope=${scope}`);
export const listTemplateAttributes = (categoryId: number) =>
  request<ProductAttributeRecord[]>(`${root}/attribute-options?categoryId=${categoryId}`);
export const listTemplateValues = (categoryId: number, attributeId: number) =>
  request<ProductAttributeValueRecord[]>(`${root}/value-options?categoryId=${categoryId}&attributeId=${attributeId}`);
export const listTemplateVersions = (categoryId: number) =>
  request<TemplateVersion[]>(`${root}?categoryId=${categoryId}`);
export const createTemplateDraft = (payload: { categoryId: number }) =>
  request<TemplateVersion>(root, { method: 'POST', body: JSON.stringify(payload) });
export const copyTemplateDraft = (id: number, draft?: { draftId: number; revision: number }) =>
  request<TemplateVersion>(`${root}/${id}/copy`, { method: 'POST', body: JSON.stringify(draft ?? {}) });
export const saveTemplateDraft = (
  id: number,
  revision: number,
  content: TemplateVersion['content'],
  changeNote: string,
) =>
  request<TemplateVersion>(`${root}/${id}`, { method: 'PUT', body: JSON.stringify({ revision, content, changeNote }) });
export const saveTemplateDisplayOrder = (id: number, revision: number, attributeIds: number[]) =>
  request<TemplateVersion>(`${root}/${id}/display-order`, {
    method: 'PUT',
    body: JSON.stringify({ revision, attributeIds }),
  });
export const publishTemplateDraft = (id: number, revision: number) =>
  request<TemplateVersion>(`${root}/${id}/publish`, { method: 'POST', body: JSON.stringify({ revision }) });
export const discardTemplateDraft = (id: number, revision: number) =>
  request<boolean>(`${root}/${id}?revision=${revision}`, { method: 'DELETE' });
export const versionLabel = (version?: TemplateVersion) =>
  version ? (version.state === 'draft' ? '草稿' : `V${version.versionNo}`) : '暂无版本';
