import { describe, expect, it } from 'vitest';
import { effectScope, ref } from 'vue';
import { useListBatchSelection } from './useListBatchSelection';

describe('permission-filtered list batch selection', () => {
  it('uses explicit batch capability, preserving zero-selection and temporarily disabled actions', () => {
    const scope = effectScope();
    scope.run(() => {
      const actions = ref<{ batch?: boolean; disabled?: boolean; label?: string }[]>([{ label: '批量处理' }]);
      const selected = ref<number[]>([4]);
      const list = useListBatchSelection(actions, selected);
      const columns = [{ colKey: 'row-select', type: 'multiple' }, { colKey: 'name' }];
      expect(list.hasBatchActions.value).toBe(false);
      expect(selected.value).toEqual([]);
      expect(list.selectionColumns(columns)).toEqual([{ colKey: 'name' }]);
      actions.value = [{ batch: true, disabled: true }];
      expect(list.hasBatchActions.value).toBe(true);
      expect(list.selectionColumns(columns)).toBe(columns);
      selected.value = [2, 4];
      actions.value = [{ batch: true, disabled: false }];
      expect(selected.value).toEqual([2, 4]);
      actions.value = [{ label: '清空回收站' }];
      expect(selected.value).toEqual([]);
    });
    scope.stop();
  });
  it('clears only invalid selection on tab or capability changes and supports custom selection columns', () => {
    const scope = effectScope();
    scope.run(() => {
      const actions = ref([{ batch: true }]);
      const selected = ref(['a', 'b']);
      const tab = ref('warehouse');
      const list = useListBatchSelection(actions, selected, tab);
      expect(selected.value).toEqual(['a', 'b']);
      tab.value = 'selling';
      expect(selected.value).toEqual([]);
      selected.value = ['c'];
      actions.value = [{ batch: true }];
      expect(selected.value).toEqual(['c']);
      actions.value = [];
      expect(selected.value).toEqual([]);
      expect(list.selectionColumns([{ colKey: 'select' }, { colKey: 'name' }], 'select')).toEqual([{ colKey: 'name' }]);
    });
    scope.stop();
  });
});
