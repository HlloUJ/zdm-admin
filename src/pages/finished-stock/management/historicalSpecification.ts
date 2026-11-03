import type { LayeredSpecField, StockItem } from '../shared/finishedStockPageModel';

/** Presentation fallback only; never reconstruct or persist missing historical dimensions. */
export function operationsHistoricalLayeredFields(
  product: Pick<StockItem, 'specDimensions' | 'attributeTemplateSnapshot' | 'attributeDisplayOrder' | 'variants'>,
): LayeredSpecField[] {
  if (product.specDimensions?.length)
    return product.specDimensions.map((dimension) => dimension.key) as LayeredSpecField[];
  const order = product.attributeDisplayOrder?.sales ?? [];
  const rank = (key: string) => {
    const index = order.indexOf(key);
    return index < 0 ? Number.MAX_SAFE_INTEGER : index;
  };
  return (product.attributeTemplateSnapshot ?? [])
    .filter((field) => field.attributeRole === 'sales' && field.skuFlag === true)
    .slice()
    .sort(
      (left, right) =>
        rank(`attribute_${left.attributeId}`) - rank(`attribute_${right.attributeId}`) ||
        left.sortOrder - right.sortOrder,
    )
    .map((field) => `attribute_${field.attributeId}` as LayeredSpecField)
    .filter((key) => product.variants.some((variant) => Object.hasOwn(variant.salesAttributes ?? {}, key)));
}
