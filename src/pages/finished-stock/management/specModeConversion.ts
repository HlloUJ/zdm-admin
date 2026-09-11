export interface ConversionGroup {
  field: string;
  values: string[];
}
const normalize = (value: string) => value.trim().replace(/[\s/]+/g, '');
// Only accept a unique complete match against known values; never guess free text.
export function matchSpecText(text: string, groups: ConversionGroup[]): Record<string, string> | undefined {
  if (!groups.length || groups.some((group) => !group.values.length)) return;
  const target = normalize(text);
  const matches: Record<string, string>[] = [];
  let attempts = 0;
  function visit(index: number, remaining: string, result: Record<string, string>) {
    if (++attempts > 10000 || matches.length > 1) return;
    if (index === groups.length) {
      if (!remaining) matches.push(result);
      return;
    }
    const group = groups[index];
    for (const value of new Set(group.values)) {
      const token = normalize(value);
      if (token && remaining.startsWith(token))
        visit(index + 1, remaining.slice(token.length), { ...result, [group.field]: value });
    }
  }
  visit(0, target, {});
  return attempts <= 10000 && matches.length === 1 ? matches[0] : undefined;
}
export function specIdentity(values: Record<string, unknown>, fields: string[]): string {
  return JSON.stringify([...fields].sort().map((field) => [field, String(values[field] ?? '').trim()]));
}

// Existing row attributes may include non-dimension fields. Only use the unique
// ordered subset whose complete text matches the single specification label.
export function matchSpecAttributeSubset(text: string, attributes: Record<string, string>, maxFields = 3) {
  const entries = Object.entries(attributes).filter(([, value]) => value.trim());
  const matches: Record<string, string>[] = [];
  const target = normalize(text);
  function visit(start: number, selected: [string, string][], combined: string) {
    if (selected.length && combined === target) matches.push(Object.fromEntries(selected));
    if (selected.length >= maxFields || matches.length > 1) return;
    for (let i = start; i < entries.length; i++) {
      const next = combined + normalize(entries[i][1]);
      if (target.startsWith(next)) visit(i + 1, [...selected, entries[i]], next);
    }
  }
  visit(0, [], '');
  return matches.length === 1 ? matches[0] : undefined;
}
