import { describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { defineComponent, h, ref, nextTick } from 'vue';
import AdminDialog from '../AdminDialog.vue';
import AdminConfirmDialog from '../AdminConfirmDialog.vue';
import AdminFormDialog from '../official/AdminFormDialog.vue';
import {
  confirmationText,
  dialogButtonProps,
  formConfirmation,
  formConfirmationText,
  operationConfirmation,
  type Confirmation,
} from './confirmation';
import registry from './button-functions.json';
const Dialog = defineComponent({
  props: {
    confirmBtn: { type: Object, default: undefined },
    cancelBtn: { type: [Object, String], default: undefined },
  },
  emits: ['confirm', 'cancel', 'close'],
  setup:
    (_, { slots }) =>
    () =>
      h('div', slots.default?.()),
});
const global = {
  stubs: {
    't-dialog': Dialog,
    't-space': { template: '<div><slot /></div>' },
    't-form': { template: '<form><slot /></form>' },
  },
};
describe('global execution button naming', () => {
  it('generates the exact create/edit names and rejects unknown modes', () => {
    expect(formConfirmationText('create')).toBe('确认新增');
    expect(formConfirmationText('edit')).toBe('确认保存');
    expect(() => formConfirmationText('unknown' as 'create')).toThrow();
  });
  it('generates registered operations with batch retained once, including legacy explicit aliases', () => {
    for (const [action, name] of Object.entries(registry.confirmationActions)) {
      expect(confirmationText(operationConfirmation(action))).toBe(`确认${name}`);
      expect(confirmationText(operationConfirmation(action, true))).toBe(
        `确认${name.startsWith('批量') ? '' : '批量'}${name}`,
      );
    }
    expect(confirmationText(operationConfirmation('停用', true))).toBe('确认批量停用');
    expect(confirmationText(operationConfirmation('放回'))).toBe('确认放回仓库');
    expect(() => operationConfirmation('未登记动作')).toThrow();
    expect(() =>
      confirmationText({ kind: 'operation', action: '未知', batch: false } as unknown as Confirmation),
    ).toThrow();
  });
  it('keeps loading, disabled and callbacks while the registry owns text and existing mapping owns color', () => {
    const onClick = vi.fn();
    const options = { content: '旧名称', theme: 'primary' as const, loading: true, disabled: true, onClick };
    expect(dialogButtonProps('off-shelf', operationConfirmation('下架', true), options)).toEqual({
      ...options,
      content: '确认批量下架',
      theme: 'warning',
    });
    expect(options.content).toBe('旧名称');
    expect(dialogButtonProps('submit', formConfirmation('edit'), null)).toBeNull();
    expect(dialogButtonProps('close', { kind: 'none' })).toBeNull();
  });
  for (const component of [AdminDialog, AdminFormDialog]) {
    it(`${component.__name} switches from create to edit without changing submission or state options`, async () => {
      const mode = ref<'create' | 'edit'>('create');
      const onConfirm = vi.fn();
      const Host = {
        render: () =>
          h(component, {
            visible: true,
            header: '标题保持原样',
            data: {},
            confirmFunction: 'submit',
            confirmation: formConfirmation(mode.value),
            confirmBtn: { loading: true, disabled: true },
            onConfirm,
          }),
      };
      const wrapper = mount(Host, { global });
      const dialog = wrapper.findComponent(Dialog);
      expect(dialog.props('confirmBtn')).toMatchObject({
        content: '确认新增',
        loading: true,
        disabled: true,
        theme: 'primary',
      });
      mode.value = 'edit';
      await nextTick();
      expect(dialog.props('confirmBtn')).toMatchObject({ content: '确认保存', loading: true, disabled: true });
      dialog.vm.$emit('confirm');
      expect(onConfirm).toHaveBeenCalledTimes(1);
    });
  }
  it('preserves simple confirmation descriptions, batch state, blocked close and hidden action behavior', async () => {
    const batch = ref(false);
    const mode = ref<'confirm' | 'blocked'>('confirm');
    const onConfirm = vi.fn();
    const Host = {
      render: () =>
        h(AdminConfirmDialog, {
          visible: true,
          function: 'disable',
          action: '停用',
          description: '原有说明',
          batch: batch.value,
          mode: mode.value,
          onConfirm,
        }),
    };
    const wrapper = mount(Host, { global });
    const dialog = wrapper.findComponent(Dialog);
    expect(wrapper.text()).toContain('原有说明');
    expect(dialog.props('confirmBtn')).toMatchObject({ content: '确认停用', theme: 'warning' });
    batch.value = true;
    await nextTick();
    expect(dialog.props('confirmBtn')).toMatchObject({ content: '确认批量停用', theme: 'warning' });
    mode.value = 'blocked';
    await nextTick();
    expect(dialog.props('confirmBtn')).toMatchObject({ content: '我知道了', theme: 'default' });
    expect(dialog.props('cancelBtn')).toBeNull();
    dialog.vm.$emit('confirm');
    expect(wrapper.findComponent(AdminConfirmDialog).emitted('update:visible')).toEqual([[false]]);
    expect(onConfirm).toHaveBeenCalledTimes(1);
    const hidden = mount(
      { render: () => h(AdminConfirmDialog, { visible: false, function: 'close', action: '' }) },
      { global },
    );
    expect(hidden.findComponent(Dialog).props('confirmBtn')).toBeNull();
  });
});

it('registers only the product batch shelf result acknowledgement as a read-only confirmation', () => {
  expect(confirmationText({ kind: 'acknowledgement', action: 'productBatchShelfResult' })).toBe('确认');
  expect(dialogButtonProps('close', { kind: 'acknowledgement', action: 'productBatchShelfResult' })?.content).toBe(
    '确认',
  );
  expect(() => confirmationText({ kind: 'acknowledgement', action: 'unknown' } as unknown as Confirmation)).toThrow();
  expect(confirmationText({ kind: 'close', text: '关闭' })).toBe('关闭');
  expect(confirmationText({ kind: 'close', text: '我知道了' })).toBe('我知道了');
});
