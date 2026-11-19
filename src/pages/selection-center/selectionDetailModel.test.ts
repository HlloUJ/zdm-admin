import { describe, expect, it } from 'vitest';
import type { CenterDetail } from '@/services/storeSelectionCenter';
import { selectionAttributes, selectionSalesModel } from './selectionDetailModel';
const information = (): CenterDetail['information'] => ({
  name: '商品',
  categoryName: '类目',
  totalStock: 0,
  imageUrls: [],
  videoUrl: null,
  detail: '',
  attributes: [],
  attributeNames: {},
  specDimensions: [],
  skus: [],
});
describe('selection detail configuration', () => {
  it('renders actual single specs and arbitrary attributes without inventing rows or losing zero', () => {
    const info = information();
    info.skus = [
      {
        skuId: 8,
        label: '实际规格',
        stock: 0,
        partnerPrice: 0,
        displayMode: 'single',
        salesAttributes: { attribute_2: '0', attribute_3: '防护' },
      },
    ];
    info.attributeNames = { attribute_2: '厚度', attribute_3: '用途' };
    info.attributeDisplayOrder = { product: [], sales: ['attribute_3', 'attribute_2'] };
    const model = selectionSalesModel(info);
    expect(model.rows).toHaveLength(1);
    expect(model.rows[0]).toMatchObject({ skuId: 8, label: '实际规格', stock: 0, price: '¥ 0', attribute_2: '0' });
    expect(model.columns.map((c) => c.title)).toEqual(['商品规格', '价格', '用途', '厚度', '可供库存']);
    expect(model).not.toHaveProperty('span');
  });
  it('keeps layered order but repeats every dimension in each flat SKU row', () => {
    const info = information();
    info.specDimensions = [
      { key: 'color', name: '颜色', values: ['白', '黑'] },
      { key: 'size', name: '尺寸', values: ['小', '大'] },
    ];
    info.skus = [
      ['黑', '大'],
      ['白', '大'],
      ['白', '小'],
    ].map(([color, size], i) => ({
      skuId: i + 1,
      label: '实际SKU',
      stock: i,
      partnerPrice: i + 10,
      displayMode: 'layered',
      salesAttributes: { color, size },
    }));
    const model = selectionSalesModel(info);
    expect(model.rows.map((r) => r.skuId)).toEqual([3, 2, 1]);
    expect(model.columns.map((c) => c.colKey)).toEqual(['color', 'size', 'price', 'stock']);
    expect(model).not.toHaveProperty('span');
    expect(model.rows.map((r) => [r.color, r.size, r.stock, r.price])).toEqual([
      ['白', '小', 2, '¥ 12'],
      ['白', '大', 1, '¥ 11'],
      ['黑', '大', 0, '¥ 10'],
    ]);
    expect(model.columns.every((col) => col.thClassName === 'selection-sales-heading')).toBe(true);
  });
  it('uses saved product field order and does not mutate the source', () => {
    const info = information();
    info.attributes = [
      { attributeId: 1, attributeName: '历史字段', value: '值' },
      { attributeId: 2, attributeName: '新字段', value: '0' },
    ];
    info.attributeDisplayOrder = { product: ['2', '1'], sales: [] };
    expect(selectionAttributes(info).map((a) => a.attributeId)).toEqual([2, 1]);
    expect(info.attributes[0].attributeId).toBe(1);
  });
  it('retains historical dedicated SKU values for configured dimensions', () => {
    const info = information();
    info.specDimensions = [{ key: 'size', name: '历史尺寸', values: ['大'] }];
    info.skus = [{ skuId: 1, label: '历史规格', stock: 1, partnerPrice: 12, displayMode: 'layered', sizeValue: '大' }];
    const model = selectionSalesModel(info);
    expect(model.rows[0]).toMatchObject({ size: '大' });
    expect(model.columns.find((c) => c.colKey === 'size')?.title).toBe('历史尺寸');
  });
});
