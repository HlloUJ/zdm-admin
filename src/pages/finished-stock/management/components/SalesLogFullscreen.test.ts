import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import { expect, it } from 'vitest';
import SalesLogFullscreen from './SalesLogFullscreen.vue';
it('expands the same content and restores it with Escape', async () => {
  const wrapper = mount(SalesLogFullscreen, {
    attachTo: document.body,
    slots: { default: '<input value="historical table" />' },
    global: { stubs: { 't-button': { template: '<button><slot /></button>' } } },
  });
  const content = wrapper.find('input').element;
  await wrapper.find('button').trigger('click');
  expect(document.querySelector('.sales-fullscreen-panel.is-fullscreen input')).toBe(content);
  expect(document.querySelector('.is-fullscreen button')?.getAttribute('aria-label')).toBe('还原');
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  await nextTick();
  expect(document.querySelector('.sales-fullscreen-panel.is-fullscreen')).toBeNull();
  expect(wrapper.find('input').element).toBe(content);
  expect(wrapper.find('button').attributes('aria-label')).toBe('全屏显示');
  wrapper.unmount();
});
