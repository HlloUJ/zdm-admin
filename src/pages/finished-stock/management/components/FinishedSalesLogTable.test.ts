import { mount } from '@vue/test-utils';
import { it, expect, vi, afterEach } from 'vitest';
import FinishedSalesLogTable from './FinishedSalesLogTable.vue';
const loginUser = vi.hoisted(() => ({ clientCode: 'admin' }));
vi.mock('@/services/auth', () => ({ getLoginUser: () => loginUser }));
afterEach(() => {
  loginUser.clientCode = 'admin';
});
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
  expect(vm.columns.map((c) => c.title)).toEqual(['商品规格', '成本价', '指导价', '1级合伙人', '数量']);
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

it('shows supply-chain historical variant costs without platform pricing columns', () => {
  loginUser.clientCode = 'supply-chain';
  const wrapper = mount(FinishedSalesLogTable, {
    shallow: true,
    props: {
      snapshot: {
        销售规格: [
          { variantKey: 'a', variantLabel: '规格A', stock: 2, costPrice: 0 },
          { variantKey: 'b', variantLabel: '规格B', stock: 3, costPrice: 1200 },
          { variantKey: 'c', variantLabel: '历史未记录成本', stock: 1 },
        ],
        指导价: [{ variantKey: 'b', costPrice: 9999, price: 20000 }],
        层级价格: [{ variantKey: 'b', storeLevelId: 1, storeLevelName: '1级合伙人', price: 15000 }],
      },
      other: {},
    },
  });
  const vm = wrapper.vm as unknown as {
    rows: any[];
    columns: { title: string; cell: (render: null, context: { row: any }) => { children: unknown } }[];
  };
  expect(vm.columns.map((c) => c.title)).toEqual(['商品规格', '成本价', '数量']);
  expect(vm.rows.map((row) => row.cost)).toEqual([0, 1200, undefined]);
  const cost = vm.columns.find((column) => column.title === '成本价')!;
  expect(cost.cell(null, { row: vm.rows[0] }).children).toEqual(['0.00']);
  expect(cost.cell(null, { row: vm.rows[2] }).children).toEqual(['未记录']);
});
it('compares before and after costs directly from the supply-chain variant snapshots', () => {
  loginUser.clientCode = 'supply-chain';
  const wrapper = mount(FinishedSalesLogTable, {
    shallow: true,
    props: {
      highlightChanges: true,
      snapshot: { 销售规格: [{ variantKey: 'a', variantLabel: '规格A', stock: 2, costPrice: 1200 }] },
      other: { 销售规格: [{ variantKey: 'a', variantLabel: '规格A', stock: 2, costPrice: 1000 }] },
    },
  });
  const vm = wrapper.vm as unknown as { rows: any[]; changedCell: (row: any, key: string) => boolean };
  expect(vm.rows[0].cost).toBe(1200);
  expect(vm.changedCell(vm.rows[0], 'cost')).toBe(true);
  expect(vm.changedCell(vm.rows[0], 'quantity')).toBe(false);
});
