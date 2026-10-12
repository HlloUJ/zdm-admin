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
  expect(vm.changedCell(vm.rows[0], 'specText')).toBe(false);
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
  expect(cost.cell(null, { row: vm.rows[2] }).children).toEqual(['-']);
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

it('uses stored sales field order instead of JSON object key order', async () => {
  loginUser.clientCode = 'supply-chain';
  const snapshot = {
    销售规格: [{ skuId: 1, variantLabel: '规格', salesAttributes: { attribute_2: '白', attribute_12: '木' } }],
    销售属性名称: { attribute_2: '颜色', attribute_12: '材质' },
    字段顺序: { sales: ['attribute_12', 'attribute_2'] },
  };
  const wrapper = mount(FinishedSalesLogTable, { shallow: true, props: { snapshot, other: {} } });
  const vm = wrapper.vm as unknown as { columns: { title: string }[] };
  expect(vm.columns.slice(-2).map((col) => col.title)).toEqual(['材质', '颜色']);
  await wrapper.setProps({ snapshot: { ...snapshot, 字段顺序: undefined } });
  expect(vm.columns.slice(-2).map((col) => col.title)).toEqual(['颜色', '材质']);
});

it.each(['single', 'layered'])(
  'renders store sale snapshots for %s specifications with changed cell highlighting',
  (displayMode) => {
    const before = {
      skuId: 101,
      variantLabel: '餐桌',
      stock: 2,
      displayMode,
      salesAttributes: displayMode === 'layered' ? { color: '白色' } : {},
      saleCoefficient: 1.5,
      salePrice: 150,
      priceMode: 'auto',
    };
    const after = { ...before, saleCoefficient: 2, salePrice: 200, priceMode: 'manual' };
    const common = {
      规格维度: [{ key: 'color', name: '颜色' }],
      指导价: [{ skuId: 101, price: 500 }],
      层级价格: [{ skuId: 101, storeLevelId: 1, storeLevelName: '门店级别', price: 100 }],
    };
    const wrapper = mount(FinishedSalesLogTable, {
      shallow: true,
      props: {
        snapshot: { ...common, 销售规格: [after] },
        other: { ...common, 销售规格: [before] },
        storeMode: true,
        highlightChanges: true,
      },
    });
    const vm = wrapper.vm as unknown as {
      rows: any[];
      columns: any[];
      changedCell: (row: any, key: string) => boolean;
    };
    expect(vm.columns.map((column) => column.title)).toEqual([
      displayMode === 'layered' ? '颜色' : '商品规格',
      '指导价',
      '门店级别价',
      '商品售价',
      '数量',
    ]);
    expect(vm.rows[0].sale).toMatchObject({ saleCoefficient: 2, salePrice: 200, priceMode: 'manual' });
    expect(vm.changedCell(vm.rows[0], 'sale')).toBe(true);
    expect(vm.changedCell(vm.rows[0], 'guide')).toBe(false);
  },
);

it('marks additions and retains deleted rows with historical prices', () => {
  const wrapper = mount(FinishedSalesLogTable, {
    shallow: true,
    props: {
      supplyEdit: true,
      side: 'after',
      highlightChanges: true,
      snapshot: {
        销售规格: [
          { skuId: 2, variantLabel: '保留', stock: 1 },
          { skuId: 3, variantLabel: '新增', stock: 1 },
        ],
      },
      other: {
        销售规格: [
          { skuId: 1, variantLabel: '删除', stock: 1 },
          { skuId: 2, variantLabel: '保留', stock: 1 },
        ],
        指导价: [{ skuId: 1, price: 123 }],
      },
    },
  });
  const vm = wrapper.vm as unknown as { rows: any[]; rowState: (row: any) => string };
  expect(vm.rows.map((row) => row.skuId)).toEqual([1, 2, 3]);
  expect(vm.rowState(vm.rows[0])).toBe('deleted');
  expect(vm.rows[0].guide.price).toBe(123);
  expect(vm.rowState(vm.rows[2])).toBe('added');
});
it('separates deleted rows when the historical structure differs', () => {
  const wrapper = mount(FinishedSalesLogTable, {
    shallow: true,
    props: {
      supplyEdit: true,
      side: 'after',
      snapshot: {
        销售规格: [{ skuId: 2, displayMode: 'layered', salesAttributes: { color: '白' } }],
        规格维度: [{ key: 'color', name: '颜色' }],
      },
      other: { 销售规格: [{ skuId: 1, variantLabel: '删除', displayMode: 'single' }] },
    },
  });
  const vm = wrapper.vm as unknown as { rows: any[]; separateDeleted: any[]; deletedSnapshot: any };
  expect(vm.rows).toHaveLength(1);
  expect(vm.separateDeleted[0].skuId).toBe(1);
  expect(vm.deletedSnapshot['销售规格'][0].displayMode).toBe('single');
});

it.each([
  ['supply-chain', 'single'],
  ['supply-chain', 'layered'],
  ['admin', 'single'],
  ['admin', 'layered'],
  ['store', 'single'],
  ['store', 'layered'],
])('renders empty historical values as a dash and retains zero for %s/%s', (client, mode) => {
  loginUser.clientCode = client;
  const wrapper = mount(FinishedSalesLogTable, {
    shallow: true,
    props: {
      storeMode: client === 'store',
      snapshot: {
        销售规格: [
          {
            skuId: 1,
            displayMode: mode,
            variantLabel: '',
            stock: 0,
            costPrice: 0,
            salesAttributes: { color: '', extra: null },
          },
        ],
        规格维度: mode === 'layered' ? [{ key: 'color', name: '颜色' }] : [],
        指导价: [{ skuId: 1, price: null }],
      },
      other: {},
    },
  });
  const vm = wrapper.vm as unknown as { rows: any[]; columns: any[] };
  for (const key of ['color', 'extra']) {
    expect(vm.columns.find((column) => column.colKey === key).cell(null, { row: vm.rows[0] }).children).toEqual(['-']);
  }
  expect(vm.columns.find((column) => column.colKey === 'quantity').cell(null, { row: vm.rows[0] }).children).toEqual([
    '0',
  ]);
});
