import { mount } from '@vue/test-utils';
import { defineComponent, nextTick, ref } from 'vue';
import { InputNumber } from 'tdesign-vue-next';
import { describe, expect, it, vi } from 'vitest';
import DecimalInput from './DecimalInput.vue';
import SpecPriceInput from '@/pages/finished-stock/management/components/SpecPriceInput.vue';

function editor(largeNumber = true, initial: string | number | undefined = '51.00', spec = false) {
  const value = ref(initial);
  const change = vi.fn();
  const commit = vi.fn();
  const wrapper = mount(
    defineComponent({
      components: { DecimalInput, SpecPriceInput },
      setup: () => ({ value, largeNumber, change, commit }),
      template: spec
        ? '<SpecPriceInput v-model="value" label="价格" placeholder="价格" :submitted="false" @change="change" @commit="commit" />'
        : '<DecimalInput v-model="value" :large-number="largeNumber" :decimal-places="2" theme="normal" @change="change" />',
    }),
    { attachTo: document.body, global: { components: { 't-input-number': InputNumber } } },
  );
  return { wrapper, input: wrapper.find('input'), value, change, commit };
}

describe('小数编辑草稿（真实 TDesign 输入框）', () => {
  it.each([true, false])('删除末位后可继续输入小数，字符串模式=%s', async (largeNumber) => {
    const { wrapper, input, value } = editor(largeNumber, largeNumber ? '51' : 51);
    input.element.focus();
    for (const text of ['51', '5', '5.', '5.0', '5.02']) {
      await input.setValue(text);
      expect(input.element.value).toBe(text);
    }
    expect(value.value).toBe(largeNumber ? '5.02' : 5.02);
    input.element.blur();
    await nextTick();
    expect(input.element.value).toBe('5.02');
    wrapper.unmount();
  });

  it('鼠标停留时通过组件入口聚焦，删除后仍可直接输入小数点', async () => {
    const { wrapper, input, value } = editor(true, '2.00', true);
    await wrapper.find('.t-input').trigger('mouseenter');
    wrapper.findComponent(InputNumber).vm.$.exposed!.focus();
    await nextTick();
    for (const text of ['52', '5', '5.', '5.2']) {
      await input.setValue(text);
      expect(input.element.value).toBe(text);
    }
    expect(value.value).toBe('5.2');
    wrapper.unmount();
  });

  it.each(['.', 'Decimal', 'Delete', '\0', ','])('小键盘小数点按物理键识别，key=%s', async (key) => {
    const { wrapper, input, value } = editor(true, '2.00', true);
    input.element.focus();
    await input.setValue('52');
    await input.setValue('5');
    input.element.setSelectionRange(1, 1);
    await input.trigger('keydown', { key, code: 'NumpadDecimal' });
    expect(input.element.value).toBe('5.');
    await input.setValue('5.2');
    expect(value.value).toBe('5.2');
    input.element.setSelectionRange(3, 3);
    await input.trigger('keydown', { key, code: 'NumpadDecimal' });
    expect(input.element.value).toBe('5.2');
    wrapper.unmount();
  });

  it('数值型配置聚焦保留两位显示，不重置下一次编辑的选区', async () => {
    const { wrapper, input } = editor(false, 0.7);
    expect(input.element.value).toBe('0.70');
    input.element.focus();
    input.element.setSelectionRange(0, 4);
    await nextTick();
    expect(input.element.value).toBe('0.70');
    expect(input.element.selectionStart).toBe(0);
    expect(input.element.selectionEnd).toBe(4);
    await input.setValue('0.51');
    input.element.blur();
    await nextTick();
    input.element.focus();
    await nextTick();
    expect(input.element.value).toBe('0.51');
    wrapper.unmount();
  });

  it('父级格式化回写不覆盖聚焦中的小数点或尾零', async () => {
    const { wrapper, input, value } = editor();
    input.element.focus();
    await input.setValue('5.');
    value.value = '5.00';
    await nextTick();
    expect(input.element.value).toBe('5.');
    await input.setValue('5.0');
    value.value = '5.00';
    await nextTick();
    expect(input.element.value).toBe('5.0');
    await input.setValue('5.02');
    expect(value.value).toBe('5.02');
    wrapper.unmount();
  });

  it('非聚焦字段继续接收价格联动，程序赋值不触发手工编辑事件', async () => {
    const { wrapper, input, value, change } = editor();
    value.value = '123.40';
    await nextTick();
    expect(input.element.value).toBe('123.40');
    expect(change).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it.each([true, false])('清空、重填、两位精度与键盘步进保留，字符串模式=%s', async (largeNumber) => {
    const { wrapper, input, value } = editor(largeNumber, largeNumber ? '51' : 51);
    input.element.focus();
    await input.setValue('');
    expect(value.value).toBe(largeNumber ? '' : undefined);
    await input.setValue('0.25');
    expect(input.element.value).toBe('0.25');
    await input.setValue('0.257');
    expect(input.element.value).toBe('0.25');
    await input.trigger('keydown', { key: 'ArrowUp', code: 'ArrowUp' });
    expect(Number(value.value)).toBe(1.25);
    wrapper.unmount();
  });

  it('价格封装保留失焦格式化与真实编辑提交；格式等价修改不提交', async () => {
    const { wrapper, input, value, commit } = editor(true, '5.00', true);
    input.element.focus();
    await input.setValue('5');
    input.element.blur();
    await nextTick();
    expect(commit).not.toHaveBeenCalled();
    input.element.focus();
    await input.setValue('5.2');
    input.element.blur();
    await nextTick();
    expect(value.value).toBe('5.20');
    expect(input.element.value).toBe('5.20');
    expect(commit).toHaveBeenCalledTimes(1);
    wrapper.unmount();
  });

  it('只读、禁用、上下限与错误提示继续由官方组件处理', async () => {
    const wrapper = mount(DecimalInput, {
      props: { modelValue: '0', largeNumber: true },
      attrs: { min: 0.01, max: 1, disabled: true, theme: 'normal', tips: '原有提示' },
      global: { components: { 't-input-number': InputNumber } },
    });
    expect(wrapper.find('input').element.disabled).toBe(true);
    expect(wrapper.find('.t-input').classes()).toContain('t-is-error');
    expect(wrapper.text()).toContain('原有提示');
    wrapper.unmount();
  });
  it('new specifications may defer feedback until submit without changing ordinary price blur validation', async () => {
    const wrapper = mount(SpecPriceInput, {
      props: { modelValue: '', label: '价格', placeholder: '价格', submitted: false, validationDeferred: true },
      global: { components: { 't-input-number': InputNumber } },
    });
    await wrapper.find('input').trigger('focus');
    await wrapper.find('input').trigger('blur');
    expect(wrapper.find('.t-input__tips').exists()).toBe(false);
    await wrapper.setProps({ submitted: true, validationDeferred: false });
    expect(wrapper.text()).toContain('请输入价格');
    await wrapper.setProps({ modelValue: '10' });
    expect(wrapper.find('.t-input__tips').exists()).toBe(false);
    wrapper.unmount();
    const ordinary = editor(true, '', true);
    await ordinary.input.trigger('focus');
    await ordinary.input.trigger('blur');
    expect(ordinary.wrapper.text()).toContain('请输入价格');
    ordinary.wrapper.unmount();
  });
});
