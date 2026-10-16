import { mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { defineComponent, h } from 'vue';
import AdminListToolbar from './AdminListToolbar.vue';
const passthrough = defineComponent({
  setup:
    (_, { slots }) =>
    () =>
      h('div', slots.default?.()),
});
const global = { stubs: { 't-row': passthrough, 't-space': passthrough } };

describe('shared list toolbar', () => {
  it('does not occupy a row when no actions are available, even with stale selection', () => {
    const wrapper = mount(AdminListToolbar, { props: { selectedCount: 3, hasBatchActions: true }, global });
    expect(wrapper.find('.zdm-admin-list-toolbar').exists()).toBe(false);
  });
  it('shows the count after left actions only when batch permission and positive selection are present', async () => {
    const wrapper = mount(AdminListToolbar, {
      props: { hasActions: true, selectedCount: 0, hasBatchActions: true },
      slots: { default: '<button>批量上架</button>' },
      global,
    });
    expect(wrapper.find('.selection-info').exists()).toBe(false);
    await wrapper.setProps({ selectedCount: 2 });
    expect(wrapper.find('.toolbar-buttons').text()).toBe('批量上架已选 2 项');
    expect(wrapper.find('.selection-info').text()).toBe('已选 2 项');
    await wrapper.setProps({ hasBatchActions: false });
    expect(wrapper.find('.selection-info').exists()).toBe(false);
  });
  it('keeps auxiliary actions separate and preserves their original click handler', async () => {
    const click = vi.fn();
    const wrapper = mount(AdminListToolbar, {
      props: { hasAuxiliary: true },
      slots: { auxiliary: () => h('button', { onClick: click }, '操作日志') },
      global,
    });
    expect(wrapper.find('.toolbar-buttons').text()).toBe('');
    await wrapper.find('.zdm-admin-list-toolbar__auxiliary button').trigger('click');
    expect(click).toHaveBeenCalledOnce();
    await wrapper.setProps({ hasAuxiliary: false });
    expect(wrapper.find('.zdm-admin-list-toolbar').exists()).toBe(false);
  });
});
