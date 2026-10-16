import { describe, expect, it } from 'vitest';
import {
  finishedStockFormIssue,
  finishedStockFormIssues,
  type FinishedStockValidationInput,
} from './finishedStockFormValidation';
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
  it('collects media, name, attributes and specification issues together without changing first-reason compatibility', () => {
    const input = {
      ...validSupplyInput,
      mainImageMediaId: undefined,
      videoMediaId: undefined,
      form: { ...form, name: '', detail: '', supplier: '', material: '' },
      specRows: [],
      attributeFields: [{ key: 'material', label: '材质', required: true }],
    };
    const issues = finishedStockFormIssues(input);
    expect(issues.map((issue) => issue.message)).toEqual(
      expect.arrayContaining([
        '请上传商品主图',
        '请上传商品视频',
        '请输入宝贝详情',
        '请输入商品名称',
        '请填写材质',
        '请选择供应商',
        '请创建销售规格',
      ]),
    );
    expect(finishedStockFormIssue(input)).toEqual(issues[0]);
    expect(finishedStockFormIssues(validSupplyInput)).toEqual([]);
  });
});

it.each([0, -1, 1.5, null, undefined])(
  'rejects supply-chain non-positive-integer quantity %s on submit',
  (quantity) => {
    expect(
      finishedStockFormIssues({ ...validSupplyInput, specRows: [{ ...row, quantity } as SpecRow] }),
    ).toContainEqual({ kind: 'warning', tab: 'sales', message: '请输入每条规格大于 0 的整数数量' });
  },
);
it('accepts positive integer supply-chain quantities', () => {
  expect(finishedStockFormIssues({ ...validSupplyInput, specRows: [{ ...row, quantity: 10 }] })).toEqual([]);
});
