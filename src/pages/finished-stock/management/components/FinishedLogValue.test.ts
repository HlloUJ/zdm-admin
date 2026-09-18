import { mount } from '@vue/test-utils';
import { expect, it } from 'vitest';
import FinishedLogValue from './FinishedLogValue.vue';

it('hides merchant and variant codes in historical SQL rows and nested values', () => {
  const wrapper = mount(FinishedLogValue, {
    shallow: true,
    props: {
      value: [
        {
          variant_key: 'hidden-row-code',
          variantLabel: '规格A',
          costPrice: 10,
          nested: { merchantCode: 'hidden-nested-code', price: 20 },
        },
      ],
    },
  });
  const vm = wrapper.vm as unknown as {
    columns: { title: string; colKey: string; cell: (h: null, context: { row: unknown }) => string }[];
  };
  expect(vm.columns.map((column) => column.colKey)).not.toContain('variant_key');
  const nested = vm.columns.find((column) => column.colKey === 'nested')!;
  expect(nested.cell(null, { row: { nested: { merchantCode: 'hidden-nested-code', price: 20 } } })).toBe('价格：20');
});
