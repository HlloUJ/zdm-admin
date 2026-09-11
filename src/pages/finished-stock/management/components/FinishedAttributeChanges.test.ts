import { mount } from '@vue/test-utils';
import { it, expect } from 'vitest';
import FinishedAttributeChanges from './FinishedAttributeChanges.vue';
it('matches attributes by identity rather than reordered position and keeps additions and removals', () => {
  const wrapper = mount(FinishedAttributeChanges, {
    shallow: true,
    props: {
      before: [
        { attributeId: 1, attributeName: '材质', value: '石材' },
        { attributeId: 2, attributeName: '颜色', value: '白' },
        { attributeId: 3, attributeName: '尺寸', value: '大' },
      ],
      after: [
        { attributeId: 2, attributeName: '颜色', value: '黑' },
        { attributeId: 1, attributeName: '材质', value: '石材' },
        { attributeId: 4, attributeName: '纹理', value: '直纹' },
      ],
    },
  });
  const vm = wrapper.vm as unknown as { rows: Record<string, unknown>[]; columns: { title: string }[] };
  expect(wrapper.find('table').exists()).toBe(false);
  expect(wrapper.findAll('.attribute-name').map((el) => el.text())).toEqual(['材质', '颜色', '尺寸', '纹理']);
  expect(wrapper.findAll('.attribute-side--before')).toHaveLength(4);
  expect(wrapper.findAll('.attribute-side--after')).toHaveLength(4);
  expect(vm.rows).toEqual([
    expect.objectContaining({ name: '材质', before: '石材', after: '石材', changed: false }),
    expect.objectContaining({ name: '颜色', before: '白', after: '黑', changed: true }),
    expect.objectContaining({ name: '尺寸', before: '大', after: '已移除' }),
    expect.objectContaining({ name: '纹理', before: '未设置', after: '直纹' }),
  ]);
});
