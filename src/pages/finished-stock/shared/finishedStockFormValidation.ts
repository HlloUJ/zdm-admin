import { isPositiveIntegerQuantity } from '@/utils/quantityInput';
import { isValidSpecPriceNumber } from '../management/priceValidation';
import type { FormSectionKey, LayeredSpecField, ProductForm, SpecMode, SpecRow } from './finishedStockPageModel';

type FormField = { key: string; label: string; required: boolean };
type FormIssue = { kind: 'error' | 'warning'; message: string; tab?: FormSectionKey; operation?: true };

export interface FinishedStockValidationInput {
  client: 'admin' | 'supply-chain';
  operationsEdit: boolean;
  specMode: SpecMode;
  specDimensionsCount: number;
  layeredFields: LayeredSpecField[];
  specRows: SpecRow[];
  priceLevelIds: number[];
  form: ProductForm;
  attributeFields: FormField[];
  salesAttributeFields: FormField[];
  mainImageMediaId?: number;
  videoMediaId?: number;
  categoryId?: number;
  editingProduct: boolean;
  guidePriceSettingCoefficient?: number;
}

export const isValidSpecQuantity = (value: unknown) =>
  String(value ?? '').trim() !== '' && Number.isFinite(Number(value)) && Number(value) > 0;

export function finishedStockFormIssues(input: FinishedStockValidationInput): FormIssue[] {
  const issues: FormIssue[] = [];
  const { client, specRows, priceLevelIds } = input;
  const priceLevelsComplete = (row: SpecRow) =>
    priceLevelIds.every((id) => {
      const editor = row.markupPrices[id];
      return isValidSpecPriceNumber(editor?.coefficient) && isValidSpecPriceNumber(editor?.price);
    });
  if (input.operationsEdit) {
    const valid =
      specRows.length > 0 &&
      specRows.every(
        (row) =>
          isValidSpecPriceNumber(row.guideCoefficient) && isValidSpecPriceNumber(row.guide) && priceLevelsComplete(row),
      );
    return valid ? [] : [{ kind: 'warning', message: '请完善每条规格的指导价和合伙人价格' }];
  }
  if (input.specMode === 'layered') {
    if (!input.specDimensionsCount) {
      issues.push({ kind: 'error', message: '请先编辑并确认分层规格，补齐属性顺序' });
    }
    const combinations = specRows.map((row) => JSON.stringify(input.layeredFields.map((key) => row[key])));
    if (new Set(combinations).size !== combinations.length) {
      issues.push({ kind: 'error', message: '销售规格组合重复，请重新编辑规格' });
    }
  }
  const pricesComplete = specRows.every(
    (row) =>
      isValidSpecPriceNumber(row.cost) &&
      (client !== 'admin' || (isValidSpecPriceNumber(row.guideCoefficient) && isValidSpecPriceNumber(row.guide))) &&
      priceLevelsComplete(row),
  );
  const missingAttribute = input.attributeFields.find(
    (field) => field.required && !String(input.form[field.key] ?? '').trim(),
  );
  const missingSalesAttribute = input.salesAttributeFields.find(
    (field) => field.required && specRows.some((row) => !String(row[field.key] ?? '').trim()),
  );
  const checks: { valid: boolean; tab: FormSectionKey; message: string; operation?: true }[] = [
    { valid: Boolean(input.mainImageMediaId), tab: 'description', message: '请上传商品主图' },
    { valid: Boolean(input.videoMediaId), tab: 'description', message: '请上传商品视频' },
    { valid: Boolean(input.form.detail.trim()), tab: 'description', message: '请输入宝贝详情' },
    { valid: Boolean(input.form.name.trim()), tab: 'base', message: '请输入商品名称' },
    {
      valid: !missingAttribute,
      tab: 'base',
      message: `请填写${missingAttribute?.label ?? '必填商品属性'}`,
    },
    { valid: Boolean(input.form.supplier), tab: 'base', message: '请选择供应商' },
    { valid: input.categoryId != null, tab: 'base', message: '请选择商品分类' },
    { valid: specRows.length > 0, tab: 'sales', message: '请创建销售规格' },
    {
      valid: specRows.every((row) =>
        client === 'supply-chain' ? isPositiveIntegerQuantity(row.quantity) : isValidSpecQuantity(row.quantity),
      ),
      tab: 'sales',
      message: client === 'supply-chain' ? '请输入每条规格大于 0 的整数数量' : '请输入每条规格大于 0 的数量',
    },
    {
      valid: !missingSalesAttribute,
      tab: 'sales',
      message: `请填写每条规格的${missingSalesAttribute?.label ?? '必填销售属性'}`,
    },
    {
      valid: client !== 'admin' || input.editingProduct || input.guidePriceSettingCoefficient != null,
      tab: 'sales',
      message: '请先配置成品指导价默认系数',
      operation: true,
    },
    {
      valid: pricesComplete,
      tab: 'sales',
      message: client === 'admin' ? '请完善每条规格的成本价和指导价' : '请完善每条规格的成本价',
    },
    { valid: client !== 'admin' || Boolean(input.form.shelfNow), tab: 'sales', message: '请选择上架方式' },
  ];
  return [
    ...issues,
    ...checks
      .filter((item) => !item.valid)
      .map((item): FormIssue => ({
        kind: 'warning',
        tab: item.tab,
        message: item.message,
        ...(item.operation ? { operation: true } : {}),
      })),
  ];
}

/** Compatibility for consumers that need the original first rejection reason. */
export function finishedStockFormIssue(input: FinishedStockValidationInput): FormIssue | null {
  return finishedStockFormIssues(input)[0] ?? null;
}
