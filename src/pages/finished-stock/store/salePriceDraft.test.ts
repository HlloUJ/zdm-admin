import { describe, expect, it } from 'vitest';
import type { StoreSkuPrice } from '@/services/storeFinishedStock';
import { changeDraftCategory, createSalePriceDraft, editDraftPrice } from './salePriceDraft';
const sku: StoreSkuPrice = {
  skuId: 1,
  label: '规格',
  stock: 1,
  costPrice: 100,
  guidePrice: 200,
  salePrice: 150,
  priceMode: 'auto',
};
describe('门店商品售价', () => {
  it('跟随价格可编辑，编辑立即转手工，换分类不覆盖手工金额', () => {
    const draft = createSalePriceDraft(sku);
    editDraftPrice(draft, '140');
    changeDraftCategory(draft, sku, 2);
    expect(draft).toEqual({ skuId: 1, price: '140', mode: 'manual' });
  });
  it('无系数直接转手工保留金额，恢复系数也不自动跟随', () => {
    const draft = createSalePriceDraft(sku);
    changeDraftCategory(draft, sku, null);
    changeDraftCategory(draft, sku, 3);
    expect(draft).toEqual({ skuId: 1, price: '150.00', mode: 'manual' });
  });
  it('新售价有完整计算依据才填入跟随价格，无依据保持空值', () => {
    const draft = createSalePriceDraft({ ...sku, salePrice: null, priceMode: 'manual' });
    changeDraftCategory(draft, { ...sku, costPrice: null }, 2);
    expect(draft.price).toBe('');
    changeDraftCategory(draft, sku, 2);
    expect(draft).toEqual({ skuId: 1, price: '200.00', mode: 'auto' });
  });
});
