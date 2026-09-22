export function specIdentity(values: Record<string, unknown>, fields: string[]): string {
  return JSON.stringify([...fields].sort().map((field) => [field, String(values[field] ?? '').trim()]));
}

export interface SpecDraftGroup {
  field: string;
  withImage: boolean;
  values: { id: number; value: string; imageUploaded: boolean }[];
}

// Keep row identity and commercial data attached to the same draft. Values are
// linked by draft ID so renaming or reordering dimensions never rematches SKUs.
export function materializeLayeredSpec<T extends Record<string, unknown>>(
  source: T,
  valueIds: Record<string, number | undefined>,
  groups: SpecDraftGroup[],
): T {
  const attributes = Object.fromEntries(
    groups.flatMap((group) => {
      const entry = group.values.find((item) => item.id === valueIds[group.field]);
      const value = entry?.value?.trim() || '';
      return [
        [group.field, group.field === 'length' && value && !value.endsWith('mm') ? `${value}mm` : value],
        [`${group.field}Image`, Boolean(group.withImage && entry?.imageUploaded)],
      ];
    }),
  );
  return Object.assign(JSON.parse(JSON.stringify(source)) as T, attributes, {
    mode: 'layered',
    specText: '',
    _specOriginFields: groups.map((group) => group.field),
    _specValueIds: { ...valueIds },
  });
}

export interface LayeredSpecSource<T extends Record<string, unknown>> {
  sourceRow: T;
  valueIds: Record<string, number | undefined>;
}

// Generate from the current dimensions, then restore only unambiguous source data.
export function rebuildLayeredSpecs<T extends Record<string, unknown>>(
  groups: SpecDraftGroup[],
  sources: LayeredSpecSource<T>[],
  createRow: () => T,
  attributeFields: string[],
): T[] {
  if (!groups.length || groups.some((group) => !group.values.length)) return [];
  const fields = groups.map((group) => group.field);
  const normalizeValue = (field: string, value: unknown) => {
    const text = String(value ?? '').trim();
    return field === 'length' && text && !text.endsWith('mm') ? `${text}mm` : text;
  };
  const resolvedSources = sources.flatMap((source) => {
    const bindings: Record<string, number> = {};
    for (const group of groups) {
      const previousId = source.valueIds[group.field];
      const linked = group.values.find((value) => value.id === previousId);
      if (linked) {
        bindings[group.field] = linked.id;
        continue;
      }
      const text = normalizeValue(group.field, source.sourceRow[group.field]);
      if (!text && previousId == null) continue;
      const matches = group.values.filter((value) => normalizeValue(group.field, value.value) === text);
      if (matches.length !== 1) return [];
      bindings[group.field] = matches[0].id;
    }
    return Object.keys(bindings).length ? [{ ...source, bindings }] : [];
  });
  const combinations = groups.reduce<Record<string, number>[]>(
    (rows, group) => rows.flatMap((row) => group.values.map((value) => ({ ...row, [group.field]: value.id }))),
    [{}],
  );
  return combinations.map((valueIds) => {
    const candidates = resolvedSources.filter((source) =>
      Object.entries(source.bindings).every(([field, id]) => valueIds[field] === id),
    );
    const exact = candidates.filter((source) => Object.keys(source.bindings).length === fields.length);
    const source = exact.length === 1 ? exact[0].sourceRow : createRow();
    const row = materializeLayeredSpec(source, valueIds, groups);
    if (exact.length !== 1 && candidates.length) {
      // Attribute values can be shared by matching new combinations; SKU identity,
      // prices and inventory must never be duplicated onto those new combinations.
      for (const field of attributeFields.filter((field) => !fields.includes(field))) {
        const values = new Set(candidates.map((candidate) => String(candidate.sourceRow[field] ?? '').trim()));
        if (values.size === 1 && !values.has('')) Object.assign(row, { [field]: [...values][0] });
      }
    }
    return row;
  });
}
