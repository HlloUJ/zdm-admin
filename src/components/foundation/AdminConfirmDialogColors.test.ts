import { mount } from '@vue/test-utils';
import { defineComponent, h, nextTick, ref } from 'vue';
import { describe, expect, it } from 'vitest';
import AdminConfirmDialog from './AdminConfirmDialog.vue';
import AdminDialog from './AdminDialog.vue';
import { operationConfirmation } from './actions/confirmation';
const Dialog = defineComponent({
  props: {
    confirmBtn: { type: [Object, String], default: undefined },
    cancelBtn: { type: [Object, String], default: undefined },
    visible: { type: Boolean, default: false },
  },
  emits: ['confirm', 'cancel'],
  setup:
    (_, { slots }) =>
    () =>
      h('section', slots.default?.()),
});
const global = { stubs: { 't-dialog': Dialog } };
describe('confirmation color integration', () => {
  for (const [action, fn, theme] of [
    ['归档', 'archive', 'warning'],
    ['启用', 'enable', 'success'],
    ['放回仓库', 'restore-stock', 'success'],
    ['彻底删除', 'purge', 'danger'],
  ] as const) {
    it(`${action} keeps its function color through both dialog adapters`, async () => {
      const mode = ref<'confirm' | 'blocked'>('confirm');
      const Host = {
        render: () => h(AdminConfirmDialog, { visible: true, action, function: fn, mode: mode.value }),
      };
      const wrapper = mount(Host, { global });
      const dialog = wrapper.findComponent(Dialog);
      expect(dialog.props('confirmBtn')).toMatchObject({ content: `确认${action}`, theme });
      expect(dialog.props('cancelBtn')).toMatchObject({ content: '取消', theme: 'default' });
      dialog.vm.$emit('confirm');
      expect(wrapper.findComponent(AdminConfirmDialog).emitted('confirm')).toHaveLength(1);
      mode.value = 'blocked';
      await nextTick();
      expect(dialog.props('confirmBtn')).toMatchObject({ content: '我知道了', theme: 'default' });
      expect(dialog.props('cancelBtn')).toBeNull();
    });
  }
  it('a submission caption does not override the actual action or original button behavior', () => {
    const Host = {
      render: () =>
        h(AdminDialog, {
          visible: true,
          header: '下架',
          confirmFunction: 'off-shelf',
          confirmation: operationConfirmation('下架'),
          confirmBtn: { loading: true, disabled: true },
          cancelBtn: null,
        }),
    };
    const wrapper = mount(Host, { global });
    const dialog = wrapper.findComponent(Dialog);
    expect(dialog.props('confirmBtn')).toMatchObject({
      content: '确认下架',
      loading: true,
      disabled: true,
      theme: 'warning',
    });
    expect(dialog.props('cancelBtn')).toBeNull();
  });
});
