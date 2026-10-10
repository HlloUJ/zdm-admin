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
  status?: 'enabled' | 'disabled';
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
export const clearStorePriceBatch = (scope: StorePriceScope, targetIds: number[]) =>
  request<StorePriceRule[]>(scoped('price/batch-clear', scope), {
    method: 'POST',
    body: JSON.stringify({ targetIds }),
  });

export const saveStoreCategoryPrices = (
  scope: StorePriceScope,
  changes: { categoryId: number; coefficient: number | null }[],
) => request<StorePriceRule[]>(scoped('price/save', scope), { method: 'POST', body: JSON.stringify({ changes }) });

export const createStoreDiscount = (scope: StorePriceScope, roleId: number, coefficient: number) =>
  request<StorePriceRule[]>(scoped('discount', scope), {
    method: 'POST',
    body: JSON.stringify({ roleId, coefficient }),
  });

export const updateStoreDiscount = (scope: StorePriceScope, id: number, roleId: number, coefficient: number) =>
  request<StorePriceRule[]>(scoped(`discount/${id}`, scope), {
    method: 'PUT',
    body: JSON.stringify({ roleId, coefficient }),
  });
export const setStoreDiscountStatus = (scope: StorePriceScope, id: number, status: 'enabled' | 'disabled') =>
  request<StorePriceRule[]>(scoped(`discount/${id}/status`, scope), {
    method: 'PUT',
    body: JSON.stringify({ status }),
  });
export const deleteStoreDiscount = (scope: StorePriceScope, id: number) =>
  request<StorePriceRule[]>(scoped(`discount/${id}`, scope), { method: 'DELETE' });
