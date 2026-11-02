/** Migrated product fixtures carry their own historical definition instead of borrowing a live template. */
export function productAttributeVersionFixture(input: {
  categoryId?: number;
  attributes?: unknown[];
  variants?: unknown[];
  specDimensions?: unknown[];
}) {
  const definitions = new Map<
    number,
    {
      attributeId: number;
      name: string;
      attributeRole: string;
      valueType: string;
      requiredFlag: boolean;
      skuFlag: boolean;
      sortOrder: number;
      options: never[];
    }
  >();
  for (const value of input.attributes ?? []) {
    const attribute = value as Record<string, unknown>;
    const id = Number(attribute.attributeId);
    definitions.set(id, {
      attributeId: id,
      name: String(attribute.attributeName),
      attributeRole: 'product',
      valueType: 'text',
      requiredFlag: false,
      skuFlag: false,
      sortOrder: definitions.size + 1,
      options: [],
    });
  }
  for (const value of input.variants ?? []) {
    const variant = value as Record<string, unknown>;
    for (const key of Object.keys((variant.salesAttributes ?? {}) as object)) {
      if (!/^attribute_\d+$/.test(key)) continue;
      const id = Number(key.slice(10));
      if (definitions.has(id)) continue;
      const dimension = input.specDimensions?.find((item) => (item as Record<string, unknown>).key === key) as
        Record<string, unknown> | undefined;
      definitions.set(id, {
        attributeId: id,
        name: String(dimension?.name ?? `历史销售属性${id}`),
        attributeRole: 'sales',
        valueType: 'text',
        requiredFlag: false,
        skuFlag: true,
        sortOrder: definitions.size + 1,
        options: [],
      });
    }
  }
  return { templateVersionId: 1, templateRevision: 0, attributeTemplateSnapshot: [...definitions.values()] };
}
