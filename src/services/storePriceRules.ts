import { request } from './http';

export type StorePriceRuleKind = 'price' | 'discount';
export type StorePriceScope = 'finished' | 'accessory';
export interface StorePriceRule {
  scope: StorePriceScope;
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
const scoped = (path: string, scope: StorePriceScope) => `${base}/${path}?scope=${scope}`;
export const listStorePriceRules = (kind: StorePriceRuleKind, scope: StorePriceScope) =>
  request<StorePriceRule[]>(scoped(kind, scope));
export const listStorePriceCategories = (scope: StorePriceScope) =>
  request<StorePriceCategory[]>(scoped('price/categories', scope));
export const listStoreDiscountRoles = (scope: StorePriceScope) =>
  request<StorePriceRole[]>(scoped('discount/roles', scope));
export const saveStorePriceRule = (
  kind: StorePriceRuleKind,
  scope: StorePriceScope,
  payload: StorePriceRulePayload,
  id?: number,
) =>
  request<StorePriceRule>(scoped(`${kind}${id == null ? '' : `/${id}`}`, scope), {
    method: id == null ? 'POST' : 'PUT',
    body: JSON.stringify(payload),
  });
export const saveStorePriceBatch = (scope: StorePriceScope, categoryIds: number[], coefficient: number) =>
  request<StorePriceRule[]>(scoped('price/batch', scope), {
    method: 'POST',
    body: JSON.stringify({ categoryIds, coefficient }),
  });
export const statusStorePriceRule = (kind: StorePriceRuleKind, scope: StorePriceScope, id: number, status: string) =>
  request<StorePriceRule>(scoped(`${kind}/${id}/status`, scope), { method: 'PUT', body: JSON.stringify({ status }) });
export const deleteStorePriceRule = (kind: StorePriceRuleKind, scope: StorePriceScope, id: number) =>
  request<boolean>(scoped(`${kind}/${id}`, scope), { method: 'DELETE' });
