import type { FinishedSpecDimension } from '@/services/finishedProducts';

export function copySpecDimensions(dimensions: FinishedSpecDimension[] = []): FinishedSpecDimension[] {
  return dimensions.map((dimension) => ({ ...dimension, values: [...dimension.values] }));
}

export function orderLayeredRows<T extends Record<string, unknown>>(
  rows: T[],
  dimensions: FinishedSpecDimension[],
): T[] {
  return [...rows].sort((left, right) => {
    for (const dimension of dimensions) {
      const difference =
        dimension.values.indexOf(String(left[dimension.key])) - dimension.values.indexOf(String(right[dimension.key]));
      if (difference) return difference;
    }
    return 0;
  });
}

export function editableSalesFields<T extends { key: string }>(fields: T[], layeredKeys: string[]): T[] {
  return fields.filter((field) => !layeredKeys.includes(field.key));
}

export function layeredCellSpan(values: string[][], rowIndex: number, fieldIndex: number) {
  if (fieldIndex < 0 || !values[rowIndex]) return {};
  const row = values[rowIndex];
  const sameGroup = (candidate: string[]) =>
    row.slice(0, fieldIndex + 1).every((value, index) => candidate[index] === value);
  if (rowIndex > 0 && sameGroup(values[rowIndex - 1])) return { rowspan: 0, colspan: 0 };
  let rowspan = 1;
  while (rowIndex + rowspan < values.length && sameGroup(values[rowIndex + rowspan])) rowspan += 1;
  return { rowspan, colspan: 1 };
}
