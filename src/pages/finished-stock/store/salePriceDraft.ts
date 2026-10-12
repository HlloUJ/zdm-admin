import { isValidSpecPriceNumber } from '../management/priceValidation';
import type { StoreSkuPrice } from '@/services/storeFinishedStock';

export interface SalePriceDraft {
  skuId: number;
  price: string;
  coefficient: string;
  mode: 'auto' | 'manual';
}
export const calculateSalePrice = (base: number | null, coefficient: number | null) =>
  base == null || coefficient == null ? '' : (Math.round((base * coefficient + Number.EPSILON) * 100) / 100).toFixed(2);
export const createSalePriceDraft = (sku: StoreSkuPrice): SalePriceDraft => ({
  skuId: sku.skuId,
  price: sku.salePrice == null ? '' : Number(sku.salePrice).toFixed(2),
  coefficient: sku.saleCoefficient == null ? '' : String(sku.saleCoefficient),
  mode: sku.priceMode || 'manual',
});
export function changeDraftCategory(draft: SalePriceDraft, sku: StoreSkuPrice, coefficient: number | null) {
  const calculated = calculateSalePrice(sku.costPrice, coefficient);
  if (draft.mode === 'auto') {
    if (calculated) {
      draft.price = calculated;
      draft.coefficient = String(coefficient);
    } else draft.mode = 'manual';
  } else if (!draft.price && calculated) {
    draft.mode = 'auto';
    draft.coefficient = String(coefficient);
    draft.price = calculated;
  }
}
export function editDraftPrice(draft: SalePriceDraft, value: string, base: number | null) {
  draft.price = value;
  draft.mode = 'manual';
  if (base != null && base > 0 && isValidSpecPriceNumber(value)) draft.coefficient = (Number(value) / base).toFixed(2);
}
export function editDraftCoefficient(draft: SalePriceDraft, value: string, base: number | null) {
  draft.coefficient = value;
  draft.mode = 'manual';
  if (base != null && isValidSpecPriceNumber(value)) draft.price = calculateSalePrice(base, Number(value));
}
