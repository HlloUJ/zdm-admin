import { mount } from '@vue/test-utils';
import { it, expect } from 'vitest';
import FinishedSalesLogTable from './FinishedSalesLogTable.vue';
it('joins historical prices by variant and uses edit form column order', () => {
  const wrapper = mount(FinishedSalesLogTable, {
    shallow: true,
    props: {
      snapshot: {
        销售规格: [
          { variantKey: '2', variantLabel: '规格2', stock: 3 },
          { variantKey: '1', variantLabel: '规格1', stock: 1 },
        ],
        指导价: [
          { variantKey: '1', costPrice: 1000, price: 5000 },
          { variantKey: '2', costPrice: 1200, price: 6000 },
        ],
        层级价格: [{ variantKey: '2', storeLevelId: 1, storeLevelName: '1级合伙人', price: 1320 }],
      },
      other: {},
    },
  });
  const vm = wrapper.vm as unknown as { rows: any[]; columns: { title: string }[] };
  expect(vm.columns.map((c) => c.title)).toEqual(['商品规格', '成本价', '指导价', '1级合伙人', '数量', '商家编码']);
  expect(vm.rows[0]).toMatchObject({
    specText: '规格2',
    cost: 1200,
    quantity: 3,
    guide: { price: 6000 },
    level_1: { price: 1320 },
  });
});
it('can render price-only historical records without inventing quantity', () => {
  const wrapper = mount(FinishedSalesLogTable, {
    shallow: true,
    props: {
      snapshot: { 指导价: [{ variantKey: '1', variantLabel: '规格1', costPrice: 1000, price: 5000 }] },
      other: {},
    },
  });
  const vm = wrapper.vm as unknown as { rows: any[] };
  expect(vm.rows).toHaveLength(1);
  expect(vm.rows[0].quantity).toBeUndefined();
  expect(vm.rows[0].cost).toBe(1000);
});
it('marks only changed cells and matches specifications when merchant code changes', () => {
  const wrapper = mount(FinishedSalesLogTable, {
    shallow: true,
    props: {
      highlightChanges: true,
      snapshot: {
        销售规格: [{ variantKey: 'new', variantLabel: '规格1', stock: 2 }],
        指导价: [{ variantKey: 'new', costPrice: 10, priceCoefficient: 2, price: 20 }],
      },
      other: {
        销售规格: [{ variantKey: 'old', variantLabel: '规格1', stock: 1 }],
        指导价: [{ variantKey: 'old', costPrice: 10, priceCoefficient: 2, price: 20 }],
      },
    },
  });
  const vm = wrapper.vm as unknown as { rows: any[]; changedCell: (row: any, key: string) => boolean };
  expect(vm.changedCell(vm.rows[0], 'merchantCode')).toBe(true);
  expect(vm.changedCell(vm.rows[0], 'quantity')).toBe(true);
  expect(vm.changedCell(vm.rows[0], 'cost')).toBe(false);
  expect(vm.changedCell(vm.rows[0], 'guide')).toBe(false);
  expect(vm.changedCell(vm.rows[0], 'specText')).toBe(false);
});
