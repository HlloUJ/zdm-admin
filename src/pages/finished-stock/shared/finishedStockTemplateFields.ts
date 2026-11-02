import type { FinishedProductTemplateAttribute, FinishedSpecDimension } from '@/services/finishedProducts';
import type { ProductAttributeRecord } from '@/services/productAttributes';
import type { StockItem } from './finishedStockPageModel';

export const buildFinishedStockTemplateFields = (
  categoryId: number | undefined,
  bindings: FinishedProductTemplateAttribute[],
  dimensions: FinishedSpecDimension[],
  product: StockItem | null,
  productAttributes: ProductAttributeRecord[],
) => {
  const boundProduct = product && product.categoryId === categoryId ? product : null;
  const definitions = boundProduct ? (boundProduct.attributeTemplateSnapshot ?? []) : bindings;
  const fields = definitions
    .filter((attribute) => Boolean(boundProduct) || attribute.categoryId === categoryId)
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((attribute) => ({
      key: `attribute_${attribute.attributeId}` as const,
      role: attribute.attributeRole,
      attributeId: attribute.attributeId,
      label: attribute.name,
      required: attribute.requiredFlag,
      skuFlag: attribute.skuFlag === true,
      type: attribute.valueType === 'select' ? ('select' as const) : ('input' as const),
      options: attribute.options.map((option) => option.value),
    }));
  for (const dimension of boundProduct?.attributeTemplateSnapshot ? [] : dimensions) {
    const existing = fields.find((field) => field.key === dimension.key);
    if (existing) existing.label = dimension.name;
    else if (/^attribute_\d+$/.test(dimension.key))
      fields.push({
        key: dimension.key as `attribute_${number}`,
        attributeId: Number(dimension.key.slice(10)),
        role: 'sales',
        label: dimension.name,
        required: false,
        skuFlag: false,
        type: 'input',
        options: [],
      });
  }
  if (product && product.categoryId === categoryId && !product.attributeTemplateSnapshot) {
    for (const entry of product.attributes) {
      if (!fields.some((field) => field.attributeId === entry.attributeId)) {
        fields.push({
          key: `attribute_${entry.attributeId}`,
          role: 'product',
          attributeId: entry.attributeId,
          label: entry.attributeName,
          required: false,
          skuFlag: false,
          type: 'input',
          options: [],
        });
      }
    }
    for (const variant of product.variants) {
      for (const key of Object.keys(variant.salesAttributes ?? {})) {
        if (!/^attribute_\d+$/.test(key)) continue;
        const attributeId = Number(key.slice(10));
        if (!fields.some((field) => field.attributeId === attributeId)) {
          fields.push({
            key: `attribute_${attributeId}`,
            role: 'sales',
            attributeId,
            label:
              productAttributes.find((attribute) => attribute.id === attributeId)?.name ?? `销售属性 ${attributeId}`,
            required: false,
            skuFlag: false,
            type: 'input',
            options: [],
          });
        }
      }
    }
  }
  const order = boundProduct?.attributeDisplayOrder;
  if (order) {
    fields.sort((a, b) => {
      if (a.role !== b.role) return a.role === 'product' ? -1 : 1;
      const keys = order[a.role === 'product' ? 'product' : 'sales'];
      const index = (field: (typeof fields)[number]) => {
        const n = keys.indexOf(field.role === 'product' ? String(field.attributeId) : field.key);
        return n < 0 ? Number.MAX_SAFE_INTEGER : n;
      };
      return index(a) - index(b);
    });
  }
  return fields;
};
