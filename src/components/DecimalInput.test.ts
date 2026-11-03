import { mount } from '@vue/test-utils';
import { defineComponent, nextTick, ref } from 'vue';
import { Input, InputNumber } from 'tdesign-vue-next';
import { describe, expect, it, vi } from 'vitest';
import DecimalInput from './DecimalInput.vue';
import SpecPriceInput from '@/pages/finished-stock/management/components/SpecPriceInput.vue';

function editor(
  largeNumber = true,
  initial: string | number | undefined = '51.00',
  spec = false,
  places = 2,
  plain = false,
  allowNegative = false,
) {
  const value = ref(initial);
  const change = vi.fn();
  const commit = vi.fn();
  const wrapper = mount(
    defineComponent({
      components: { DecimalInput, SpecPriceInput },
      setup: () => ({ value, largeNumber, change, commit, places, plain, allowNegative }),
      template: spec
        ? '<SpecPriceInput v-model="value" label="价格" placeholder="价格" :submitted="false" @change="change" @commit="commit" />'
        : '<DecimalInput v-model="value" :large-number="largeNumber" :decimal-places="places" :plain="plain" :allow-negative="allowNegative" theme="normal" @change="change" />',
    }),
    { attachTo: document.body, global: { components: { 't-input-number': InputNumber, 't-input': Input } } },
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
    expect(value.value).toBe(largeNumber ? '0.25' : 0.25);
    expect(wrapper.text()).not.toContain('最多输入两位小数');
    await input.setValue('0.25');
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
      global: { components: { 't-input-number': InputNumber, 't-input': Input } },
    });
    expect(wrapper.find('input').element.disabled).toBe(true);
    expect(wrapper.find('.t-input').classes()).toContain('t-is-error');
    expect(wrapper.text()).toContain('原有提示');
    wrapper.unmount();
  });
  it('new specifications may defer feedback until submit without changing ordinary price blur validation', async () => {
    const wrapper = mount(SpecPriceInput, {
      props: { modelValue: '', label: '价格', placeholder: '价格', submitted: false, validationDeferred: true },
      global: { components: { 't-input-number': InputNumber, 't-input': Input } },
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

describe('统一数值输入规范', () => {
  it.each([0, 2])('模式 %s：零值、前导零、非法字符及粘贴不改值', async (places) => {
    const { wrapper, input, value } = editor(true, '1', false, places);
    input.element.focus();
    await input.setValue('0');
    await input.setValue('000');
    expect(input.element.value).toBe('0');
    expect(value.value).toBe('0');
    await input.setValue('-1');
    expect(input.element.value).toBe('0');
    await input.setValue('12a3');
    expect(input.element.value).toBe('0');
    input.element.setSelectionRange(0, 1);
    const paste = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(paste, 'clipboardData', { value: { getData: () => '12a3' } });
    input.element.dispatchEvent(paste);
    expect(paste.defaultPrevented).toBe(true);
    expect(input.element.value).toBe('0');
    input.element.blur();
    await nextTick();
    expect(input.element.value).toBe(places ? '0.00' : '0');
    wrapper.unmount();
  });
  it('超精度输入不应用，合法长数值不丢精度', async () => {
    const { wrapper, input, value } = editor();
    input.element.focus();
    await input.setValue('9007199254740993.12');
    await input.setValue('9007199254740993.123');
    input.element.blur();
    await nextTick();
    expect(input.element.value).toBe('9007199254740993.12');
    expect(value.value).toBe('9007199254740993.12');
    expect(wrapper.text()).not.toContain('最多输入两位小数');
    input.element.focus();
    await input.setValue('9007199254740993.12');
    expect(wrapper.text()).not.toContain('最多输入两位小数');
    input.element.blur();
    await nextTick();
    expect(input.element.value).toBe('9007199254740993.12');
    wrapper.unmount();
  });
});

it('普通属性输入外观同样保留中间状态、粘贴和两位补齐', async () => {
  const { wrapper, input, value } = editor(true, '12.00', false, 2, true);
  input.element.focus();
  await input.setValue('.');
  expect(wrapper.text()).not.toContain('请输入数字');
  input.element.blur();
  await nextTick();
  expect(wrapper.text()).toContain('请输入数字');
  input.element.focus();
  await input.setValue('0.5');
  input.element.blur();
  await nextTick();
  expect(value.value).toBe('0.50');
  expect(input.element.value).toBe('0.50');
  wrapper.unmount();
});

it('数值型字段不静默吞掉超出安全精度的整数位', async () => {
  const { wrapper, input, value } = editor(false, 1);
  input.element.focus();
  await input.setValue('9007199254740993');
  expect(value.value).toBe('9007199254740993');
  expect(input.element.value).toBe('9007199254740993');
  expect(wrapper.text()).toContain('数值超出可准确处理的范围');
  input.element.blur();
  await nextTick();
  expect(input.element.value).toBe('9007199254740993.00');
  wrapper.unmount();
});

it('只聚焦和离开数值属性，不把历史原值静默回写成规范化值', async () => {
  const { wrapper, input, value, change } = editor(true, '0012', false, 2, true);
  input.element.focus();
  input.element.blur();
  await nextTick();
  expect(value.value).toBe('0012');
  expect(change).not.toHaveBeenCalled();
  wrapper.unmount();
});

it.each([false, true])('真实控件的选区、粘贴、输入法及负零输入门禁，plain=%s', async (plain) => {
  const { wrapper, input, value, change } = editor(true, '0.12', false, 2, plain, true);
  input.element.focus();
  const insert = (text: string) => {
    const event = new InputEvent('beforeinput', {
      bubbles: true,
      cancelable: true,
      inputType: 'insertText',
      data: text,
    });
    input.element.dispatchEvent(event);
    return event;
  };
  input.element.setSelectionRange(4, 4);
  expect(insert('3').defaultPrevented).toBe(true);
  expect(value.value).toBe('0.12');
  input.element.setSelectionRange(3, 4);
  expect(insert('3').defaultPrevented).toBe(false);
  await input.setValue('0.13');
  for (const text of ['00', '-00', '12.345']) {
    input.element.setSelectionRange(0, input.element.value.length);
    const paste = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(paste, 'clipboardData', { value: { getData: () => text } });
    const calls = change.mock.calls.length;
    input.element.dispatchEvent(paste);
    expect(input.element.value).toBe('0.13');
    expect(value.value).toBe('0.13');
    expect(change).toHaveBeenCalledTimes(calls);
  }
  await input.setValue('-0');
  await input.setValue('-00');
  expect(input.element.value).toBe('-0');
  await input.setValue('-0.5');
  await input.trigger('compositionstart');
  input.element.value = '-0.567';
  await input.trigger('input');
  expect(value.value).toBe('-0.5');
  await input.trigger('compositionend');
  expect(input.element.value).toBe('-0.5');
  input.element.blur();
  await nextTick();
  expect(input.element.value).toBe('-0.50');
  wrapper.unmount();
});

it('价格封装在不完整小数校验后仍可整段替换为合法价格', async () => {
  const { wrapper, input, value } = editor(true, '', true);
  input.element.focus();
  await input.setValue('.');
  input.element.blur();
  await nextTick();
  input.element.focus();
  await input.setValue('180');
  expect(input.element.value).toBe('180');
  expect(value.value).toBe('180');
  input.element.blur();
  await nextTick();
  expect(value.value).toBe('180.00');
  expect(wrapper.text()).not.toContain('请输入数字');
  wrapper.unmount();
});

it.each([false, true])('真实删除允许临时前导零并可继续编辑，plain=%s', async (plain) => {
  const { wrapper, input, value } = editor(true, '100.23', false, 2, plain);
  input.element.focus();
  input.element.setSelectionRange(0, 1);
  input.element.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, inputType: 'deleteContentForward' }));
  input.element.value = '00.23';
  input.element.setSelectionRange(0, 0);
  input.element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContentForward' }));
  await nextTick();
  expect(input.element.value).toBe('00.23');
  expect(value.value).toBe('00.23');
  input.element.value = '0.23';
  input.element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContentForward' }));
  await nextTick();
  expect(input.element.value).toBe('0.23');
  input.element.setSelectionRange(0, input.element.value.length);
  input.element.value = '';
  input.element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward' }));
  await nextTick();
  expect(value.value).toBe('');
  await input.setValue('12.3');
  input.element.blur();
  await nextTick();
  expect(value.value).toBe('12.30');
  wrapper.unmount();
});

it.each([false, true])('中文组合结束后清除内部状态，数字连续输入不被旧值覆盖，plain=%s', async (plain) => {
  const { wrapper, input, value, change } = editor(true, '12.00', false, 2, plain);
  input.element.focus();
  input.element.setSelectionRange(0, 5);
  await input.trigger('select');
  await input.trigger('compositionstart');
  for (const text of ['z', 'zh', '中文']) {
    input.element.value = text;
    input.element.dispatchEvent(
      new InputEvent('input', { bubbles: true, inputType: 'insertCompositionText', isComposing: true }),
    );
    await nextTick();
    expect(input.element.value).toBe(text);
    expect(value.value).toBe('12.00');
  }
  await input.trigger('compositionend');
  await nextTick();
  expect(input.element.value).toBe('12.00');
  expect(input.element.selectionStart).toBe(0);
  expect(input.element.selectionEnd).toBe(5);
  expect(change).not.toHaveBeenCalled();
  for (const text of ['1', '11', '111', '111.', '111.2', '111.23']) {
    await input.setValue(text);
    await nextTick();
    expect(input.element.value).toBe(text);
    expect(value.value).toBe(text);
  }
  wrapper.unmount();
});

it.each([false, true])('不支持取消的非法输入恢复原选区，后续整数位仍可输入，plain=%s', async (plain) => {
  const { wrapper, input, value } = editor(true, '12.34', false, 2, plain);
  input.element.focus();
  input.element.setSelectionRange(1, 1);
  await input.trigger('select');
  input.element.dispatchEvent(
    new InputEvent('beforeinput', { bubbles: true, cancelable: false, inputType: 'insertText', data: '中' }),
  );
  input.element.value = '1中2.34';
  input.element.setSelectionRange(2, 2);
  input.element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: '中' }));
  await nextTick();
  expect(input.element.value).toBe('12.34');
  expect(input.element.selectionStart).toBe(1);
  expect(input.element.selectionEnd).toBe(1);
  input.element.setRangeText('5', 1, 1, 'end');
  input.element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: '5' }));
  await nextTick();
  expect(value.value).toBe('152.34');
  wrapper.unmount();
});

it.each([0, 2])('整数及负值例外也支持删除产生的中间状态，places=%s', async (places) => {
  const { wrapper, input, value } = editor(true, '-100', false, places, false, true);
  input.element.focus();
  input.element.value = places ? '-00.00' : '-00';
  input.element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContentForward' }));
  await nextTick();
  expect(input.element.value).toBe(places ? '-00.00' : '-00');
  input.element.blur();
  await nextTick();
  expect(value.value).toBe(places ? '0.00' : '0');
  input.element.focus();
  input.element.value = '';
  input.element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward' }));
  await nextTick();
  expect(value.value).toBe('');
  wrapper.unmount();
});
