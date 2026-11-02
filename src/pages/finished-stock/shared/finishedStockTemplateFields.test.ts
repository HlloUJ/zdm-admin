import { describe, expect, it } from 'vitest';
import { buildFinishedStockTemplateFields } from './finishedStockTemplateFields';
import type { FinishedProductTemplateAttribute } from '@/services/finishedProducts';
import type { StockItem } from './finishedStockPageModel';
const field = (id: number, role: 'product' | 'sales', sortOrder: number): FinishedProductTemplateAttribute => ({
  categoryId: 110,
  attributeId: id,
  name: `历史属性${id}`,
  valueType: 'text',
  attributeRole: role,
  requiredFlag: true,
  skuFlag: role === 'sales',
  sortOrder,
  options: [],
});
describe('source-product attribute version isolation', () => {
  it('ignores latest fields, live names and dimension labels when a product is bound', () => {
    const product = {
      categoryId: 110,
      attributes: [],
      variants: [],
      attributeTemplateSnapshot: [field(53, 'product', 1), field(57, 'sales', 2)],
    } as unknown as StockItem;
    const fields = buildFinishedStockTemplateFields(
      110,
      [field(58, 'sales', 1)],
      [{ key: 'attribute_58', name: '新字段', values: ['1'] }],
      product,
      [],
    );
    expect(fields.map((f) => f.key)).toEqual(['attribute_53', 'attribute_57']);
    expect(fields[1]?.label).toBe('历史属性57');
  });
  it('keeps the product order when the category template is reordered', () => {
    const product = {
      categoryId: 110,
      attributes: [],
      variants: [],
      attributeTemplateSnapshot: [field(53, 'product', 1), field(55, 'product', 2), field(57, 'sales', 3)],
      attributeDisplayOrder: { product: ['55', '53'], sales: ['attribute_57'] },
    } as unknown as StockItem;
    expect(
      buildFinishedStockTemplateFields(110, [field(58, 'sales', 1)], [], product, []).map((f) => f.attributeId),
    ).toEqual([55, 53, 57]);
  });
  it('unbound legacy products only expose persisted fields, never the latest template', () => {
    const product = {
      categoryId: 110,
      attributes: [{ attributeId: 53, attributeName: '原名称' }],
      variants: [{ salesAttributes: { attribute_57: '值' } }],
    } as unknown as StockItem;
    expect(
      buildFinishedStockTemplateFields(110, [field(58, 'sales', 1)], [], product, []).map((f) => f.attributeId),
    ).toEqual([53, 57]);
  });
});
