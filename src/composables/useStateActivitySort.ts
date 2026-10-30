import { computed, reactive, type Ref } from 'vue';
import type { TableSort } from 'tdesign-vue-next';

/** Sorting is per Tab and happens before the page slice in each consumer. */
export function useStateActivitySort(activeTab: Ref<string>, resetPage: () => void) {
  const directions = reactive<Record<string, boolean>>({});
  const descending = computed(() => directions[activeTab.value] ?? true);
  const tableSort = computed(() => ({
    sortBy: activeTab.value === 'all' ? 'createdAt' : 'stateOperatedAt',
    descending: descending.value,
  }));
  const setDirection = (value: boolean) => {
    directions[activeTab.value] = value;
    resetPage();
  };
  const toggleTimeSort = () => setDirection(!descending.value);
  const onTimeSortChange = (sort: TableSort | undefined) => {
    const next = Array.isArray(sort) ? sort[0] : sort;
    setDirection(next?.sortBy === tableSort.value.sortBy ? Boolean(next.descending) : !descending.value);
  };
  return { descending, tableSort, toggleTimeSort, onTimeSortChange };
}
