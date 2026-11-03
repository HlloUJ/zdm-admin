import { describe, expect, it } from 'vitest';
import { buildFinishedProductPayload } from './finishedStockPayload';
import type { ProductForm, SpecRow, StockItem } from './finishedStockPageModel';
describe('legacy values in a version-bound source product', () => {
  const previous = {
    attributes: [{ attributeId: 53, attributeName: '旧数字', value: '' }],
    variants: [{ id: 8, salesAttributes: {} }],
  } as unknown as StockItem;
  const context = {
    totalStock: 1,
    form: {
      name: '商品',
      supplier: '供应商',
      brand: '',
      model: '',
      style: '',
      shape: '',
      material: '',
      craftTexture: '',
      layers: '',
      functionText: '',
      waterproof: '',
      loadBearing: '',
      origin: '',
      installDesc: '',
      totalStock: 1,
      merchantCode: '',
      detail: '<p>详情</p>',
      shelfNow: 'later',
      attribute_53: '',
    } satisfies ProductForm,
    specRows: [{ skuId: 8, mode: 'single', cost: '10', quantity: 1, attribute_57: '' } as unknown as SpecRow],
    mainImageMediaId: 1,
    mainImageMediaIds: [1],
    videoMediaId: 2,
    attributeFields: [{ key: 'attribute_53', attributeId: 53, label: '旧数字' }],
    salesAttributeFields: [{ key: 'attribute_57', attributeId: 57, label: '旧选项' }],
    specMode: 'single' as const,
    specDimensions: [],
    variantLabel: () => '规格',
    previousProduct: previous,
  };
  it('keeps a stored empty entry and does not manufacture a formerly absent SKU field', () => {
    const payload = buildFinishedProductPayload(context);
    expect(payload.attributes).toEqual([{ attributeId: 53, attributeName: '旧数字', value: '' }]);
    expect(payload.variants[0]?.salesAttributes).toEqual({});
  });
  it('formats changed numeric attributes but keeps layered dimension values and unchanged raw values', () => {
    const payload = buildFinishedProductPayload({
      ...context,
      form: { ...context.form, attribute_53: '12.5' },
      attributeFields: [{ ...context.attributeFields[0]!, valueType: 'number' }],
      salesAttributeFields: [{ ...context.salesAttributeFields[0]!, valueType: 'number' }],
      specRows: [{ ...context.specRows[0]!, skuId: undefined, attribute_57: '1' }],
    });
    expect(payload.attributes[0]?.value).toBe('12.50');
    expect(payload.variants[0]?.salesAttributes?.attribute_57).toBe('1.00');
    const layered = buildFinishedProductPayload({
      ...context,
      specMode: 'layered',
      salesAttributeFields: [{ ...context.salesAttributeFields[0]!, valueType: 'number' }],
      specRows: [{ ...context.specRows[0]!, skuId: undefined, attribute_57: '1' }],
      specDimensions: [{ key: 'attribute_57', name: '原维度', values: ['1'] }],
    });
    expect(layered.variants[0]?.salesAttributes?.attribute_57).toBe('1');
    expect(layered.specDimensions?.[0]?.values).toEqual(['1']);
  });
  it('preserves unchanged raw legacy values including whitespace', () => {
    const old = {
      attributes: [{ attributeId: 53, value: ' 历史文本 ' }],
      variants: [{ id: 8, salesAttributes: { attribute_57: ' 旧值 ' } }],
    } as unknown as StockItem;
    const payload = buildFinishedProductPayload({
      ...context,
      previousProduct: old,
      form: { ...context.form, attribute_53: ' 历史文本 ' },
      specRows: [{ ...context.specRows[0]!, attribute_57: ' 旧值 ' }],
    });
    expect(payload.attributes[0]?.value).toBe(' 历史文本 ');
    expect(payload.variants[0]?.salesAttributes?.attribute_57).toBe(' 旧值 ');
  });
});
