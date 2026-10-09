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
  createdByName?: string;
  createdAt?: string;
}
export interface StorePriceCategory {
  id: number;
  parentId: number | null;
  scope: 'finished' | 'accessory';
  name: string;
  status: string;
}
export interface StorePriceRole {
  id: number;
  name: string;
  status: string;
}
const base = '/admin/store-price-rules';
const scoped = (path: string, scope: StorePriceScope) => `${base}/${path}?scope=${scope}`;
export const listStorePriceRules = (kind: StorePriceRuleKind, scope: StorePriceScope) =>
  request<StorePriceRule[]>(scoped(kind, scope));
export const listStorePriceCategories = (scope: StorePriceScope) =>
  request<StorePriceCategory[]>(scoped('price/categories', scope));
export const listStoreDiscountRoles = (scope: StorePriceScope) =>
  request<StorePriceRole[]>(scoped('discount/roles', scope));
export const saveStorePriceBatch = (
  kind: StorePriceRuleKind,
  scope: StorePriceScope,
  targetIds: number[],
  coefficient: number,
) =>
  request<StorePriceRule[]>(scoped(`${kind}/batch`, scope), {
    method: 'POST',
    body: JSON.stringify({ targetIds, coefficient }),
  });
