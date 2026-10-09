import { request } from './http';

export type StorePriceRuleKind = 'price' | 'discount';
export interface StorePriceRule {
  id: number;
  categoryId: number | null;
  roleId: number | null;
  targetName: string;
  coefficient: number;
  status: 'enabled' | 'disabled';
  createdByName?: string;
  createdAt?: string;
}
export interface StorePriceCategory {
  id: number;
  parentId: number | null;
  scope: 'finished' | 'accessory';
  name: string;
  status: string;
  effectiveCoefficient: number | null;
  sourceName: string;
}
export interface StorePriceRole {
  id: number;
  name: string;
  status: string;
}
export interface StorePriceRulePayload {
  categoryId: number | null;
  roleId: number | null;
  coefficient: number;
}
const base = '/admin/store-price-rules';
export const listStorePriceRules = (kind: StorePriceRuleKind) => request<StorePriceRule[]>(`${base}/${kind}`);
export const listStorePriceCategories = () => request<StorePriceCategory[]>(`${base}/price/categories`);
export const listStoreDiscountRoles = () => request<StorePriceRole[]>(`${base}/discount/roles`);
export const saveStorePriceRule = (kind: StorePriceRuleKind, payload: StorePriceRulePayload, id?: number) =>
  request<StorePriceRule>(`${base}/${kind}${id == null ? '' : `/${id}`}`, {
    method: id == null ? 'POST' : 'PUT',
    body: JSON.stringify(payload),
  });
export const statusStorePriceRule = (kind: StorePriceRuleKind, id: number, status: string) =>
  request<StorePriceRule>(`${base}/${kind}/${id}/status`, { method: 'PUT', body: JSON.stringify({ status }) });
export const deleteStorePriceRule = (kind: StorePriceRuleKind, id: number) =>
  request<boolean>(`${base}/${kind}/${id}`, { method: 'DELETE' });
