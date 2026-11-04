import { mount } from '@vue/test-utils';
import { nextTick, reactive } from 'vue';
import { describe, expect, it } from 'vitest';
import type { ListAction } from './types';
import ListSelectionHost from '../test-support/ListSelectionHost.test.vue';
import ListSelectionTable from '../test-support/ListSelectionTable.test.vue';
const global = { stubs: { 't-table': ListSelectionTable, 't-row': true, 't-space': true, 't-button': true } };
describe('official list default selection behavior', () => {
  it('applies the same capability to explicitly declared custom selection columns', async () => {
    const state = reactive<{
      actions: ListAction[];
      selectionColumnKey: string;
      tableProps: {
        rowKey: string;
        columns: { colKey: string; type?: 'multiple' }[];
        selectedRowKeys: (string | number)[];
      };
    }>({
      selectionColumnKey: 'select',
      actions: [],
      tableProps: { rowKey: 'id', columns: [{ colKey: 'select' }, { colKey: 'name' }], selectedRowKeys: [] },
    });
    const wrapper = mount(ListSelectionHost, { props: { state }, global });
    expect(wrapper.find('[data-column="select"]').exists()).toBe(false);
    expect(wrapper.find('[data-column="name"]').exists()).toBe(true);
    state.actions = [{ id: 'delete', label: '批量删除', function: 'delete', batch: true, disabled: true }];
    await nextTick();
    expect(wrapper.find('[data-column="select"]').exists()).toBe(true);
    wrapper.unmount();
  });

  it('hides native selection for view-only or non-selection actions and clears stale controlled values', async () => {
    const state = reactive<{
      actions: ListAction[];
      activeTab: string;
      tableProps: {
        rowKey: string;
        columns: { colKey: string; type?: 'multiple' }[];
        selectedRowKeys: (string | number)[];
      };
    }>({
      actions: [{ id: 'clear', label: '清空回收站', function: 'clear-recycle' }],
      activeTab: 'warehouse',
      tableProps: {
        rowKey: 'id',
        columns: [{ colKey: 'row-select', type: 'multiple' }, { colKey: 'name' }],
        selectedRowKeys: [1],
      },
    });
    const wrapper = mount(ListSelectionHost, { props: { state }, global });
    expect(wrapper.find('[data-column="row-select"]').exists()).toBe(false);
    expect(wrapper.find('[data-column="name"]').exists()).toBe(true);
    expect(wrapper.emitted('selectChange')).toEqual([[[]]]);
    state.tableProps.selectedRowKeys = [];
    state.actions = [{ id: 'delete', label: '批量删除', function: 'delete', batch: true, disabled: true }];
    await nextTick();
    expect(wrapper.find('[data-column="row-select"]').exists()).toBe(true);
    state.tableProps.selectedRowKeys = [2];
    await nextTick();
    state.activeTab = 'selling';
    await nextTick();
    expect(wrapper.emitted('selectChange')!.at(-1)).toEqual([[]]);
    state.actions = [];
    await nextTick();
    expect(wrapper.find('[data-column="row-select"]').exists()).toBe(false);
    wrapper.unmount();
  });
});
