export function sortByOffShelfAtDesc<T extends { id: number; offShelfAt?: string }>(rows: readonly T[]): T[] {
  const timestamp = (row: T) => Date.parse(row.offShelfAt ?? '') || 0;
  return [...rows].sort((a, b) => timestamp(b) - timestamp(a) || b.id - a.id);
}
