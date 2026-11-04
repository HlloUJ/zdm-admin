import { computed, toValue, watch, type MaybeRefOrGetter, type Ref } from 'vue';

/** Actions must already be filtered by the current user's permissions and current tab. */
export function useListBatchSelection<Key extends string | number>(
  actions: MaybeRefOrGetter<readonly { batch?: boolean }[]>,
  selected: Ref<Key[]>,
  scope?: MaybeRefOrGetter<unknown>,
) {
  const hasBatchActions = computed(() => toValue(actions).some((action) => action.batch === true));
  watch(
    [hasBatchActions, () => toValue(scope)],
    ([enabled, currentScope], previous) => {
      if ((!enabled || (previous.length > 0 && currentScope !== previous[1])) && selected.value.length)
        selected.value = [];
    },
    { immediate: true, flush: 'sync' },
  );
  function selectionColumns<Column extends { type?: string; colKey?: string }>(columns: Column[], key?: string) {
    return hasBatchActions.value
      ? columns
      : columns.filter((column) => column.type !== 'multiple' && (!key || column.colKey !== key));
  }
  return { hasBatchActions, selectionColumns };
}
