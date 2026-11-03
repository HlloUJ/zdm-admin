import { expect, it } from 'vitest';
import { operationsHistoricalLayeredFields } from './historicalSpecification';
import type { StockItem } from '../shared/finishedStockPageModel';
const product = () =>
  ({
    specDimensions: [],
    attributeTemplateSnapshot: [
      { attributeId: 2, attributeRole: 'sales', skuFlag: true, sortOrder: 2 },
      { attributeId: 1, attributeRole: 'sales', skuFlag: true, sortOrder: 1 },
      { attributeId: 3, attributeRole: 'sales', skuFlag: false, sortOrder: 3 },
      { attributeId: 4, attributeRole: 'sales', skuFlag: true, sortOrder: 4 },
    ],
    variants: [
      {
        id: 5,
        variantLabel: '原规格',
        salesAttributes: { attribute_1: '0', attribute_2: '', attribute_3: '旧普通属性', attribute_9: '未绑定字段' },
      },
    ],
  }) as unknown as StockItem;
it('uses recorded dimension order regardless of template flags or saved display order', () => {
  const source = product();
  source.specDimensions = [{ key: 'attribute_3', name: '原维度', values: [] }];
  expect(operationsHistoricalLayeredFields(source)).toEqual(['attribute_3']);
});
it('uses bound SKU flags and definition sorting, retaining zero and empty saved fields only when present', () => {
  expect(operationsHistoricalLayeredFields(product())).toEqual(['attribute_1', 'attribute_2']);
});
it('prioritizes saved display order and does not mutate or fill historical product data', () => {
  const source = product();
  source.attributeDisplayOrder = { product: [], sales: ['attribute_2', 'attribute_1'] };
  const before = structuredClone(source);
  expect(operationsHistoricalLayeredFields(source)).toEqual(['attribute_2', 'attribute_1']);
  expect(source).toEqual(before);
});
it('does not infer dimensions without a usable bound snapshot', () => {
  const source = product();
  source.attributeTemplateSnapshot = undefined;
  expect(operationsHistoricalLayeredFields(source)).toEqual([]);
  source.attributeTemplateSnapshot = [];
  expect(operationsHistoricalLayeredFields(source)).toEqual([]);
});
