import { request } from './http';
import type { FinishedProductAttributeEntry, FinishedSpecDimension } from './finishedProducts';

export type StoreFinishedStatus = 'warehouse' | 'selling' | 'offShelf' | 'soldOut' | 'recycle';

export interface StoreRolePrice {
  roleId: number;
  roleName: string;
  coefficient: number;
  price: number | null;
  priceSource: 'auto' | 'manual';
}

export interface StoreSkuPrice {
  skuId: number;
  label: string;
  stock: number;
  costPrice: number | null;
  guidePrice: number | null;
  guideSource: 'auto' | 'manual';
  rolePrices: StoreRolePrice[];
  displayMode?: 'single' | 'layered';
  salesAttributes?: Record<string, string>;
  material?: string;
  lengthValue?: string;
  color?: string;
  sizeValue?: string;
}

export interface StoreFinishedProduct {
  id: number;
  productId: number;
  name: string;
  merchantCode: string;
  status: Exclude<StoreFinishedStatus, 'soldOut'>;
  effectiveStatus: StoreFinishedStatus;
  sourceUnavailable: boolean;
  sourceMessage?: string;
  totalStock: number;
  imageUrl?: string;
  imageUrls: string[];
  videoUrl?: string;
  detail?: string;
  categoryId?: number;
  categoryName?: string;
  supplierId?: number;
  supplierName?: string;
  attributes: FinishedProductAttributeEntry[];
  specDimensions: FinishedSpecDimension[];
  skus: StoreSkuPrice[];
  createdAt?: string;
  offShelfReason?: string;
  offShelfDetail?: string;
  offShelfAt?: string;
}

export interface StorePoolProduct {
  id: number;
  name: string;
  merchantCode: string;
  totalStock: number;
  imageUrl?: string;
  categoryId?: number;
  supplierName?: string;
}

export interface StoreFinishedLog {
  id: number;
  listingId?: number;
  productId: number;
  productName: string;
  operationType: string;
  operationSummary: string;
  beforeStatus?: string;
  afterStatus?: string;
  changeDetails?: string;
  operatorName: string;
  operatedAt: string;
}

const base = '/admin/store-finished-products';
const json = (body: unknown) => JSON.stringify(body);

export const listStoreFinishedProducts = () => request<StoreFinishedProduct[]>(base);
export const getStoreFinishedProduct = (id: number) => request<StoreFinishedProduct>(`${base}/${id}`);
export const listStoreFinishedPool = () => request<StorePoolProduct[]>(`${base}/pool`);
export const selectStoreFinishedProducts = (productIds: number[]) =>
  request<StoreFinishedProduct[]>(`${base}/select`, { method: 'POST', body: json({ productIds }) });
export const changeStoreFinishedStatus = (id: number, target: string, reason?: string, detail?: string) =>
  request<StoreFinishedProduct>(`${base}/${id}/status`, { method: 'PUT', body: json({ target, reason, detail }) });
export const changeStoreFinishedStatusBatch = (ids: number[], target: string, reason?: string, detail?: string) =>
  request<StoreFinishedProduct[]>(`${base}/status/batch`, {
    method: 'PUT',
    body: json({ ids, target, reason, detail }),
  });
export const purgeStoreFinishedProduct = (id: number) => request<boolean>(`${base}/${id}`, { method: 'DELETE' });
export const purgeStoreFinishedProducts = (productIds: number[]) =>
  request<boolean>(`${base}/batch`, { method: 'DELETE', body: json({ productIds }) });
export const clearStoreFinishedRecycle = () => request<boolean>(`${base}/recycle`, { method: 'DELETE' });
export const saveStoreFinishedGuide = (id: number, skuId: number, price: number) =>
  request<StoreFinishedProduct>(`${base}/${id}/skus/${skuId}/guide-price`, { method: 'PUT', body: json({ price }) });
export const saveStoreFinishedRolePrice = (
  id: number,
  skuId: number,
  roleId: number,
  price: number | null,
  followConfiguration: boolean,
) =>
  request<StoreFinishedProduct>(`${base}/${id}/skus/${skuId}/roles/${roleId}/price`, {
    method: 'PUT',
    body: json({ price, followConfiguration }),
  });
export const getCurrentEmployeeMinimumPrice = (id: number, skuId: number) =>
  request<{ price: number; roleId: number }>(`${base}/${id}/skus/${skuId}/minimum-sale-price`);
export interface StoreFinishedLogFilter {
  keyword: string;
  operationType: string;
  operatorName: string;
  startDate: string;
  endDate: string;
  page: number;
  pageSize: number;
}
export const listStoreFinishedLogs = (filter: StoreFinishedLogFilter) => {
  const query = new URLSearchParams();
  Object.entries(filter).forEach(([key, value]) => {
    if (value !== '') query.set(key, String(value));
  });
  return request<{ records: StoreFinishedLog[]; total: number }>(`${base}/operation-logs?${query}`);
};
export const getStoreFinishedLog = (id: number) => request<StoreFinishedLog>(`${base}/operation-logs/${id}`);

export interface StorePriceConfiguration {
  id: number;
  roleId: number;
  roleName: string;
  priceCoefficient: number;
  status: 'enabled' | 'disabled';
  createdByName?: string;
  createdAt: string;
}

export interface StorePriceRoleOption {
  id: number;
  name: string;
  status: string;
}
const configBase = '/admin/store-finished-price-configurations';
export const listStorePriceConfigurations = () => request<StorePriceConfiguration[]>(configBase);
export const listStorePriceRoles = () => request<StorePriceRoleOption[]>(`${configBase}/roles`);
export const createStorePriceConfiguration = (roleId: number, priceCoefficient: number) =>
  request<StorePriceConfiguration>(configBase, { method: 'POST', body: json({ roleId, priceCoefficient }) });
export const updateStorePriceConfiguration = (id: number, roleId: number, priceCoefficient: number) =>
  request<StorePriceConfiguration>(`${configBase}/${id}`, { method: 'PUT', body: json({ roleId, priceCoefficient }) });
export const toggleStorePriceConfiguration = (id: number, status: 'enabled' | 'disabled') =>
  request<StorePriceConfiguration>(`${configBase}/${id}/status`, { method: 'PUT', body: json({ status }) });
export const deleteStorePriceConfiguration = (id: number) =>
  request<boolean>(`${configBase}/${id}`, { method: 'DELETE' });
