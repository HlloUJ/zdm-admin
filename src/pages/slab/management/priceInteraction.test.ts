import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminDialog, adminFeedback } from '@/components/foundation';
import PriceSourceToggle from '@/pages/finished-stock/management/components/PriceSourceToggle.vue';
import SpecPriceInput from '@/pages/finished-stock/management/components/SpecPriceInput.vue';

vi.mock('@/components/foundation', () => ({
  adminFeedback: { warning: vi.fn() },
  AdminDialog: { props: ['visible'], emits: ['confirm', 'cancel'], template: '<div><slot /></div>' },
}));
const global = { stubs: { 't-tooltip': { template: '<div><slot /></div>' }, 't-input-number': true } };

describe('大板复用成品现货价格交互', () => {
  beforeEach(() => vi.clearAllMocks());
  it('跟随配置需确认后才切换，取消不会修改价格来源', async () => {
    const wrapper = mount(PriceSourceToggle, { props: { source: 'auto', available: true }, global });
    expect(wrapper.find('button').text()).toBe('跟');
    await wrapper.find('button').trigger('click');
    expect(wrapper.emitted('toggle')).toBeUndefined();
    expect(wrapper.findComponent(AdminDialog).props('visible')).toBe(true);
    wrapper.findComponent(AdminDialog).vm.$emit('cancel');
    expect(wrapper.emitted('toggle')).toBeUndefined();
    await wrapper.find('button').trigger('click');
    wrapper.findComponent(AdminDialog).vm.$emit('confirm');
    expect(wrapper.emitted('toggle')).toHaveLength(1);
  });
  it('无配置时提示并拦截恢复跟随，只读时不能切换', async () => {
    const wrapper = mount(PriceSourceToggle, { props: { source: 'manual', available: false }, global });
    await wrapper.find('button').trigger('click');
    expect(adminFeedback.warning).toHaveBeenCalledWith('暂无有效价格配置，无法切换为跟随配置');
    expect(wrapper.emitted('toggle')).toBeUndefined();
    await wrapper.setProps({ readonly: true, available: true });
    expect(wrapper.find('button').attributes('disabled')).toBeDefined();
  });
  it('数值格式化不触发手工来源，真实编辑失焦时触发', async () => {
    const wrapper = mount(SpecPriceInput, {
      props: { modelValue: '1', label: '价格', placeholder: '价格', submitted: false },
      global,
    });
    const input = wrapper.findComponent({ name: 't-input-number' });
    input.vm.$emit('focus');
    await wrapper.setProps({ modelValue: '1.00' });
    input.vm.$emit('blur');
    expect(wrapper.emitted('commit')).toBeUndefined();
    input.vm.$emit('focus');
    await wrapper.setProps({ modelValue: '2.00' });
    input.vm.$emit('blur');
    expect(wrapper.emitted('commit')).toHaveLength(1);
  });
  it('提交后空值标红，负数拒绝，合法零值允许', async () => {
    const wrapper = mount(SpecPriceInput, {
      props: { modelValue: '', label: '价格', placeholder: '价格', submitted: false },
      global,
    });
    const input = () => wrapper.findComponent({ name: 't-input-number' });
    expect(input().attributes('status')).toBeUndefined();
    await wrapper.setProps({ submitted: true });
    expect(input().attributes('status')).toBe('error');
    await wrapper.setProps({ modelValue: '-1' });
    expect(input().attributes('status')).toBe('error');
    await wrapper.setProps({ modelValue: '0.00' });
    expect(input().attributes('status')).toBeUndefined();
  });
});
