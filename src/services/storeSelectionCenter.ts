import { request } from './http';
import type { FinishedProductAttributeEntry, FinishedSpecDimension } from './finishedProducts';
export type ProductType = 'finished' | 'accessory';
export interface CenterContext {
  key: string;
  storeName: string;
  maintain: Record<ProductType, boolean>;
}
export interface CenterCategory {
  type: ProductType;
  id: number;
  parentId: number | null;
  name: string;
}
export interface CategoryNode {
  id: number;
  key: string;
  label: string;
  type: ProductType;
  children: CategoryNode[];
}
export interface CenterProduct {
  type: ProductType;
  id: number;
  name: string;
  categoryId: number | null;
  sourceCreatedAt: string;
  imageUrl: string | null;
  priceMin: number | null;
  priceMax: number | null;
  soldOut: boolean;
  addedToStore: boolean;
  inSelection: boolean;
  canAdd: boolean;
  reasons: string[];
  selectionId: number | null;
  addedAt: string | null;
}
export interface CenterPage {
  records: CenterProduct[];
  total: number;
  page: number;
  pageSize: number;
}
export interface CenterSku {
  skuId: number;
  label: string;
  stock: number;
  partnerPrice: number | null;
  displayMode: 'single' | 'layered';
  salesAttributes?: Record<string, string>;
  material?: string;
  lengthValue?: string;
  color?: string;
  sizeValue?: string;
}
export interface CenterDetail {
  product: CenterProduct;
  information: {
    name: string;
    categoryName: string;
    totalStock: number;
    imageUrls: string[];
    videoUrl: string | null;
    detail: string;
    attributes: FinishedProductAttributeEntry[];
    attributeNames: Record<string, string>;
    attributeDisplayOrder?: { product: string[]; sales: string[] };
    specDimensions: FinishedSpecDimension[];
    skus: CenterSku[];
  };
}
export interface CenterResult {
  id: number;
  status: 'processing' | 'completed';
  total: number;
  successCount: number;
  failureCount: number;
  failures: { type: ProductType; productId: number; name: string; code: string; reason: string }[];
}
const base = '/admin/store-product-center';
function params(values: Record<string, string | number | string[] | null | undefined>) {
  const query = new URLSearchParams();
  Object.entries(values).forEach(([key, value]) => {
    if (value != null && value !== '' && (!Array.isArray(value) || value.length)) query.set(key, String(value));
  });
  return query.toString();
}
export const centerContext = () => request<CenterContext>(`${base}/context`);
export const centerCategories = (context: string) =>
  request<CenterCategory[]>(`${base}/categories?${params({ context })}`);
export const centerProducts = (
  context: string,
  filter: {
    keyword: string;
    types: string[];
    states: string[];
    categoryType?: string;
    categoryId?: number;
    page: number;
    pageSize: number;
  },
) => request<CenterPage>(`${base}/products?${params({ context, ...filter })}`);
export const centerDetail = (context: string, type: ProductType, id: number) =>
  request<CenterDetail>(`${base}/products/${type}/${id}?${params({ context })}`);
export const centerSelection = (context: string, type: ProductType, page: number, pageSize: number) =>
  request<{ page: CenterPage; counts: Record<ProductType, number> }>(
    `${base}/selection?${params({ context, type, page, pageSize })}`,
  );
export const addCenterSelection = (context: string, type: ProductType, productId: number) =>
  request<boolean>(`${base}/selection`, { method: 'POST', body: JSON.stringify({ context, type, productId }) });
export const removeCenterSelection = (context: string, id: number) =>
  request<boolean>(`${base}/selection/${id}?${params({ context })}`, { method: 'DELETE' });
export const joinCenterSelection = (context: string, requestId: string) =>
  request<CenterResult>(`${base}/join-batches`, { method: 'POST', body: JSON.stringify({ context, requestId }) });
export const centerBatchResult = (context: string, id: number) =>
  request<CenterResult>(`${base}/join-batches/${id}?${params({ context })}`);
export function categoryTree(rows: CenterCategory[], type: ProductType): CategoryNode[] {
  const nodes = new Map(
    rows
      .filter((r) => r.type === type)
      .map((r) => [r.id, { id: r.id, key: `${type}:${r.id}`, label: r.name, type, children: [] as CategoryNode[] }]),
  );
  const roots: CategoryNode[] = [];
  for (const row of rows.filter((r) => r.type === type)) {
    const node = nodes.get(row.id)!;
    if (row.parentId && nodes.has(row.parentId)) nodes.get(row.parentId)!.children.push(node);
    else roots.push(node);
  }
  return roots;
}
export function centerPrice(p: Pick<CenterProduct, 'priceMin' | 'priceMax'>) {
  const money = (value: number) => Number(value).toLocaleString('zh-CN', { maximumFractionDigits: 2 });
  return p.priceMin == null || p.priceMax == null
    ? '—'
    : p.priceMin === p.priceMax
      ? money(p.priceMin)
      : `${money(p.priceMin)} – ${money(p.priceMax)}`;
}
