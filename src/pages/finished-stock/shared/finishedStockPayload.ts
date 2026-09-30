import type { FinishedProductPayload, FinishedSpecDimension } from '@/services/finishedProducts';
import type { ProductForm, SpecMode, SpecRow } from './finishedStockPageModel';

interface AttributeField {
  key: string;
  attributeId: number;
  label: string;
}

interface ProductPayloadContext {
  totalStock: number;
  form: ProductForm;
  specRows: SpecRow[];
  categoryId?: number;
  supplierId?: number;
  mainImageMediaId: number;
  mainImageMediaIds: number[];
  videoMediaId: number;
  attributeFields: AttributeField[];
  salesAttributeFields: AttributeField[];
  specMode: SpecMode;
  specDimensions: FinishedSpecDimension[];
  variantLabel: (row: SpecRow) => string;
  offShelfReason?: string;
  offShelfDetail?: string;
}

export const buildFinishedProductPayload = (context: ProductPayloadContext): FinishedProductPayload => {
  const stock = context.totalStock || Number(context.form.totalStock || 0);
  const guidePrice = Number(context.specRows[0]?.guide || 0);
  const status = context.form.shelfNow === 'now' ? 'selling' : 'warehouse';
  return {
    categoryId: context.categoryId,
    supplierId: context.supplierId,
    name: context.form.name.trim(),
    sku: context.form.merchantCode.trim(),
    mainImageMediaId: context.mainImageMediaId,
    mainImageMediaIds: context.mainImageMediaIds,
    videoMediaId: context.videoMediaId,
    detail: context.form.detail.trim(),
    totalStock: stock,
    guidePrice: guidePrice > 0 ? guidePrice : undefined,
    attributeDisplayOrder: {
      product: context.attributeFields.map((field) => String(field.attributeId)),
      sales: context.salesAttributeFields.map((field) => field.key),
    },
    attributes: context.attributeFields
      .map((field) => ({
        attributeId: field.attributeId,
        attributeName: field.label,
        value: String(context.form[field.key] ?? '').trim(),
      }))
      .filter((attribute) => attribute.value),
    specDimensions: context.specMode === 'layered' ? context.specDimensions : [],
    variants: context.specRows.map((row) => ({
      id: row.skuId,
      variantLabel: context.variantLabel(row),
      displayMode: row.mode,
      salesAttributes: Object.fromEntries(
        context.salesAttributeFields.map((field) => [field.key, String(row[field.key] ?? '').trim()]),
      ),
      material: row.material || undefined,
      lengthValue: row.length || undefined,
      color: row.color || undefined,
      sizeValue: row.size || undefined,
      costPrice: Number(row.cost),
      stock: Number(row.quantity || 0),
    })),
    offShelfReason: context.offShelfReason,
    offShelfDetail: context.offShelfDetail,
    status,
  };
};

interface OperationsPricePayloadContext {
  name: string;
  status: FinishedProductPayload['status'];
  specRows: SpecRow[];
  priceLevels: Array<{ id: number; name: string }>;
  variantLabel: (row: SpecRow) => string;
}

export const buildFinishedOperationsPricePayload = (
  context: OperationsPricePayloadContext,
): Pick<FinishedProductPayload, 'name' | 'status' | 'guidePrices' | 'markupPrices'> => ({
  name: context.name,
  status: context.status,
  guidePrices: context.specRows.map((row) => ({
    skuId: row.skuId!,
    variantLabel: context.variantLabel(row),
    costPrice: Number(row.cost),
    priceCoefficient: Number(row.guideCoefficient),
    price: Number(row.guide),
  })),
  markupPrices: context.specRows.flatMap((row) =>
    context.priceLevels.map((level) => {
      const price = row.markupPrices[level.id];
      return {
        skuId: row.skuId!,
        variantLabel: context.variantLabel(row),
        storeLevelId: level.id,
        storeLevelName: level.name,
        costPrice: Number(row.cost),
        priceCoefficient: Number(price.coefficient),
        price: Number(price.price),
        priceSource: price.priceSource,
        sourceConfigurationId: price.sourceConfigurationId,
      };
    }),
  ),
});
