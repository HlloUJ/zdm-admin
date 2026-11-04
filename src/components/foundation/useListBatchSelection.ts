import { computed, onScopeDispose, toValue, watch, type MaybeRefOrGetter, type Ref } from 'vue';

/** Actions must already be filtered by the current user's permissions and current tab. */
export function useListBatchSelection<Key extends string | number>(
  actions: MaybeRefOrGetter<readonly { batch?: boolean }[]>,
  selected: Ref<Key[]>,
  scope?: MaybeRefOrGetter<unknown>,
  managesSelection: MaybeRefOrGetter<boolean> = true,
) {
  const hasBatchActions = computed(() => toValue(actions).some((action) => action.batch === true));
  let generation = 0;
  let alive = true;
  onScopeDispose(() => {
    alive = false;
    generation++;
  });
  watch(
    [hasBatchActions, () => toValue(scope), () => toValue(managesSelection)],
    ([enabled, currentScope], previous) => {
      generation++;
      if (
        toValue(managesSelection) &&
        (!enabled || (previous.length > 0 && currentScope !== previous[1])) &&
        selected.value.length
      )
        selected.value = [];
    },
    { immediate: true, flush: 'sync' },
  );
  function selectionColumns<Column extends { type?: string; colKey?: string }>(columns: Column[], key?: string) {
    return hasBatchActions.value
      ? columns
      : columns.filter((column) => column.type !== 'multiple' && (!key || column.colKey !== key));
  }
  function captureSelectionContext() {
    const captured = generation;
    const enabled = hasBatchActions.value && toValue(managesSelection);
    return () => alive && enabled && captured === generation && hasBatchActions.value && toValue(managesSelection);
  }
  return { hasBatchActions, selectionColumns, captureSelectionContext };
}
