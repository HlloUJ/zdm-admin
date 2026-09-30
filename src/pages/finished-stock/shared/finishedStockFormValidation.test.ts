import { describe, expect, it } from 'vitest';
import { finishedStockFormIssue, type FinishedStockValidationInput } from './finishedStockFormValidation';
import type { ProductForm, SpecRow } from './finishedStockPageModel';

const form = {
  name: '测试商品',
  supplier: '测试供应商',
  detail: '<p>详情</p>',
  shelfNow: 'later',
} as ProductForm;
const row = {
  id: 1,
  cost: '10',
  guideCoefficient: '',
  guide: '',
  quantity: 1,
  markupPrices: {},
} as SpecRow;
const validSupplyInput: FinishedStockValidationInput = {
  client: 'supply-chain',
  operationsEdit: false,
  specMode: 'single',
  specDimensionsCount: 0,
  layeredFields: [],
  specRows: [row],
  priceLevelIds: [],
  form,
  attributeFields: [],
  salesAttributeFields: [],
  mainImageMediaId: 1,
  videoMediaId: 2,
  categoryId: 3,
  editingProduct: false,
};

describe('finished stock form validation across clients', () => {
  it('keeps supply-chain cost rules separate from admin guide-price rules', () => {
    expect(finishedStockFormIssue(validSupplyInput)).toBeNull();
    expect(
      finishedStockFormIssue({
        ...validSupplyInput,
        client: 'admin',
        guidePriceSettingCoefficient: 1.2,
      }),
    ).toMatchObject({ tab: 'sales', message: '请完善每条规格的成本价和指导价' });
  });

  it('reports a repeated layered combination before ordinary missing fields', () => {
    expect(
      finishedStockFormIssue({
        ...validSupplyInput,
        specMode: 'layered',
        specDimensionsCount: 1,
        layeredFields: ['material'],
        specRows: [
          { ...row, material: '木纹' },
          { ...row, id: 2, material: '木纹' },
        ] as SpecRow[],
        mainImageMediaId: undefined,
      }),
    ).toMatchObject({ kind: 'error', message: '销售规格组合重复，请重新编辑规格' });
  });
});
