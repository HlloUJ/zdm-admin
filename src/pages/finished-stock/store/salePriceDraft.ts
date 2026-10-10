import type { StoreSkuPrice } from '@/services/storeFinishedStock';

export interface SalePriceDraft {
  skuId: number;
  price: string;
  mode: 'auto' | 'manual';
}
export const calculateSalePrice = (base: number | null, coefficient: number | null) =>
  base == null || coefficient == null ? '' : (Math.round((base * coefficient + Number.EPSILON) * 100) / 100).toFixed(2);
export const createSalePriceDraft = (sku: StoreSkuPrice): SalePriceDraft => ({
  skuId: sku.skuId,
  price: sku.salePrice == null ? '' : Number(sku.salePrice).toFixed(2),
  mode: sku.priceMode || 'manual',
});
export function changeDraftCategory(draft: SalePriceDraft, sku: StoreSkuPrice, coefficient: number | null) {
  const calculated = calculateSalePrice(sku.costPrice, coefficient);
  if (draft.mode === 'auto') {
    if (calculated) draft.price = calculated;
    else draft.mode = 'manual';
  } else if (!draft.price && calculated) {
    draft.mode = 'auto';
    draft.price = calculated;
  }
}
export function editDraftPrice(draft: SalePriceDraft, value: string) {
  draft.price = value;
  draft.mode = 'manual';
}
