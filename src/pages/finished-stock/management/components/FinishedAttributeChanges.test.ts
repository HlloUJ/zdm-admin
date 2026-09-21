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
  expect(wrapper.findAll('.attribute-name').map((el) => el.text())).toEqual(['颜色', '尺寸', '纹理']);
  expect(wrapper.findAll('.attribute-side--before')).toHaveLength(3);
  expect(wrapper.findAll('.attribute-side--after')).toHaveLength(3);
  expect(vm.rows).toEqual([
    expect.objectContaining({ name: '颜色', before: '白', after: '黑', changed: true }),
    expect.objectContaining({ name: '尺寸', before: '大', after: '已移除' }),
    expect.objectContaining({ name: '纹理', before: '未设置', after: '直纹' }),
  ]);
});

it('does not display unchanged attributes after reordering', () => {
  const before = [
    { attributeId: 1, attributeName: '材质', value: '石材' },
    { attributeId: 2, attributeName: '颜色', value: '白' },
  ];
  const wrapper = mount(FinishedAttributeChanges, {
    shallow: true,
    props: { before, after: [...before].reverse() },
  });
  expect(wrapper.findAll('.attribute-change')).toHaveLength(0);
});

it('uses recorded form order for new logs while preserving legacy order', async () => {
  const wrapper = mount(FinishedAttributeChanges, {
    props: {
      before: [
        { attributeId: 1, attributeName: '材质', value: '石材' },
        { attributeId: 2, attributeName: '颜色', value: '白' },
      ],
      after: [
        { attributeId: 1, attributeName: '材质', value: '木材' },
        { attributeId: 2, attributeName: '颜色', value: '黑' },
      ],
      order: ['2', '1'],
    },
    shallow: true,
  });
  expect(wrapper.findAll('.attribute-name').map((node) => node.text())).toEqual(['颜色', '材质']);
  await wrapper.setProps({ order: undefined });
  expect(wrapper.findAll('.attribute-name').map((node) => node.text())).toEqual(['材质', '颜色']);
});
