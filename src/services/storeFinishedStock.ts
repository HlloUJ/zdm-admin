import { request } from './http';
import type { FinishedProductAttributeEntry, FinishedSpecDimension } from './finishedProducts';

export type StoreFinishedStatus = 'warehouse' | 'selling' | 'offShelf' | 'soldOut' | 'recycle';

export interface StoreSkuPrice {
  skuId: number;
  label: string;
  stock: number;
  costPrice: number | null;
  guidePrice: number | null;
  salePrice: number | null;
  priceMode: 'auto' | 'manual';
  displayMode?: 'single' | 'layered';
  salesAttributes?: Record<string, string>;
  material?: string;
  lengthValue?: string;
  color?: string;
  sizeValue?: string;
}

export interface StoreFinishedProduct {
  attributeNames?: Record<string, string>;
  storeLevelName?: string | null;
  storeCategoryId: number | null;
  storeCategoryName: string;
  categoryCoefficient: number | null;
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
  attributes: FinishedProductAttributeEntry[];
  specDimensions: FinishedSpecDimension[];
  skus: StoreSkuPrice[];
  createdByName?: string;
  createdAt?: string;
  offShelfReason?: string;
  offShelfDetail?: string;
  offShelfAt?: string;
}

export interface StorePoolSku extends Omit<StoreSkuPrice, 'costPrice' | 'salePrice' | 'priceMode'> {
  partnerPrice: number | null;
}

export interface StorePoolDetail {
  storeLevelName?: string | null;
  attributeNames: Record<string, string>;
  id: number;
  name: string;
  merchantCode: string;
  totalStock: number;
  imageUrl?: string;
  imageUrls: string[];
  videoUrl?: string;
  detail?: string;
  categoryName?: string;
  attributes: FinishedProductAttributeEntry[];
  specDimensions: FinishedSpecDimension[];
  skus: StorePoolSku[];
}

export interface StorePoolCategory {
  id: number;
  parentId?: number | null;
  name: string;
}

export const listStoreFinishedCategories = () => request<StorePoolCategory[]>(`${base}/categories`);
export const listStoreFinishedPoolCategories = () => request<StorePoolCategory[]>(`${base}/pool-categories`);

export interface StorePoolProduct {
  storeLevelName?: string | null;
  guidePriceMin?: number | null;
  guidePriceMax?: number | null;
  partnerPriceMin?: number | null;
  partnerPriceMax?: number | null;
  id: number;
  name: string;
  merchantCode: string;
  totalStock: number;
  imageUrl?: string;
  categoryId?: number;
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
export const getStoreFinishedPoolDetail = (id: number) => request<StorePoolDetail>(`${base}/pool/${id}`);
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
export interface StoreFinishedEditCategory {
  id: number;
  parentId: number | null;
  name: string;
  status: string;
  coefficient: number | null;
}
export const listStoreFinishedEditCategories = (id: number) =>
  request<StoreFinishedEditCategory[]>(`${base}/${id}/edit-categories`);
export const saveStoreFinishedEdit = (
  id: number,
  payload: {
    storeCategoryId: number;
    skus: { skuId: number; salePrice: number | null; priceMode: 'auto' | 'manual' }[];
  },
) => request<StoreFinishedProduct>(`${base}/${id}`, { method: 'PUT', body: json(payload) });
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
