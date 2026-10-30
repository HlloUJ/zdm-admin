import { ref } from 'vue';
import { expect, it, vi } from 'vitest';
import { useStateActivitySort } from './useStateActivitySort';
it('keeps each Tab direction and resets pagination on title or native icon changes', () => {
  const tab = ref('warehouse');
  const reset = vi.fn();
  const sort = useStateActivitySort(tab, reset);
  expect(sort.descending.value).toBe(true);
  sort.toggleTimeSort();
  expect(sort.descending.value).toBe(false);
  tab.value = 'selling';
  expect(sort.descending.value).toBe(true);
  sort.onTimeSortChange({ sortBy: 'stateOperatedAt', descending: false });
  expect(sort.descending.value).toBe(false);
  sort.onTimeSortChange(undefined);
  expect(sort.descending.value).toBe(true);
  tab.value = 'warehouse';
  expect(sort.descending.value).toBe(false);
  expect(reset).toHaveBeenCalledTimes(3);
});

it('All sorts by creation independently from state time and returns to page one for both controls', () => {
  const tab = ref('all');
  const reset = vi.fn();
  const sort = useStateActivitySort(tab, reset);
  expect(sort.tableSort.value).toEqual({ sortBy: 'createdAt', descending: true });
  sort.toggleTimeSort();
  expect(sort.descending.value).toBe(false);
  tab.value = 'warehouse';
  expect(sort.tableSort.value).toEqual({ sortBy: 'stateOperatedAt', descending: true });
  tab.value = 'all';
  expect(sort.descending.value).toBe(false);
  sort.onTimeSortChange({ sortBy: 'createdAt', descending: true });
  expect(sort.descending.value).toBe(true);
  expect(reset).toHaveBeenCalledTimes(2);
});
