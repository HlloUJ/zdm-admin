import { describe, expect, it, vi } from 'vitest';
import { makeProductForm, type SlabItem } from './slabPageModel';
import { fillSlabProductForm, toSlabPayload } from './slabPageMapping';

const item = {
  id: 7,
  name: '测试大板',
  code: 'SLAB-7',
  image: '',
  size: '',
  origin: '',
  texture: '',
  color: '',
  grade: '',
  store: '-',
  tenant: '测试供应商',
  publisherType: '平台发布',
  createdByName: '',
  createdAt: '',
  variety: '',
  sku: '',
  supplierId: 2,
  status: 'warehouse',
  stock: 3,
  price: { cost: '1,000', guide: '1500', level1: '', level2: '', level3: '' },
  offShelfRecords: [],
} satisfies SlabItem;

describe('shared slab page mapping', () => {
  it('keeps warehouse omission and numeric price conversion in payloads', () => {
    expect(toSlabPayload(item)).toMatchObject({
      name: '测试大板',
      serialNo: 'SLAB-7',
      warehouse: undefined,
      costPrice: 1000,
      guidePrice: 1500,
      status: 'warehouse',
    });
    expect(toSlabPayload(item, { store: '成品仓' }).warehouse).toBe('成品仓');
  });

  it('fills the edit form and passes saved prices to the editor initializer', () => {
    const form = makeProductForm();
    const initializePrices = vi.fn();
    fillSlabProductForm(item, form, initializePrices);

    expect(form).toMatchObject({ supplier: '测试供应商', cost: '1,000', stock: '3', guideRatio: '1.50' });
    expect(initializePrices).toHaveBeenCalledWith(undefined);
  });
});
