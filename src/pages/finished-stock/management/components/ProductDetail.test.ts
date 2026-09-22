import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import ProductDetail from './ProductDetail.vue';

const product = {
  id: 1,
  name: '测试商品',
  code: '',
  category: '家具',
  supplier: '供应商',
  stock: 2,
  publisherType: '平台发布',
  status: 'offShelf',
  createdByName: '测试',
  image: '/image.png',
  detail: '<p>图文介绍</p><img src="/detail.png" onerror="alert(1)"><script>alert(1)</script>',
  offShelfReason: '价格调整',
  offShelfDetail: '等待供应商确认',
  attributes: [],
  variants: [],
};
const wrapper = () =>
  mount(ProductDetail, {
    props: { product, attributeNames: {} },
    global: {
      stubs: {
        't-space': { template: '<div><slot /></div>' },
        AdminSectionCard: { template: '<section><slot /></section>' },
        't-descriptions': { template: '<div><slot /></div>' },
        't-descriptions-item': { template: '<div><slot /></div>' },
        't-table': true,
        't-empty': true,
      },
    },
  });
describe('商品只读详情', () => {
  it('仅展示商品资料并清理图文中的可执行内容', () => {
    const view = wrapper();
    expect(view.text()).not.toContain('等待供应商确认');
    expect(view.text()).not.toContain('操作信息');
    expect(view.text()).toContain('图文介绍');
    expect(view.find('script').exists()).toBe(false);
    expect(view.find('.product-detail__description img').attributes('onerror')).toBeUndefined();
    expect(view.find('input').exists()).toBe(false);
  });
  it('点击主图提供大图预览', async () => {
    const view = wrapper();
    await view.find('button').trigger('click');
    expect(view.emitted('preview')?.[0]).toEqual([{ url: '/image.png' }, 'image']);
  });
});

it('运营详情按 SKU ID 匹配价格，保留零成本值且不展示商家编码', async () => {
  const view = wrapper();
  await view.setProps({
    operations: true,
    product: {
      ...product,
      sourceStatus: 'offShelf',
      sourceUnavailable: true,
      variants: [{ id: 11, variantLabel: '标准规格', stock: 2, costPrice: 0 }],
      guidePrices: [{ skuId: 11, costPrice: 99, priceCoefficient: 2, price: 198 }],
    },
  });
  const vm = view.vm as unknown as { columns: { colKey: string }[]; rows: { merchantCode: string; cost: number }[] };
  expect(vm.columns.map((column) => column.colKey)).toEqual(['label', 'cost', 'guide', 'stock']);
  expect(vm.rows[0]).toMatchObject({ cost: 0, guide: '2 / 198' });
  expect(view.find('input').exists()).toBe(false);
});

it('运营分层详情按日志方式排序和合并规格，价格库存仍绑定原 SKU', async () => {
  const view = wrapper();
  const variants = [
    {
      id: 13,
      variantLabel: '小 / 黑',
      stock: 3,
      costPrice: 30,
      displayMode: 'layered' as const,
      salesAttributes: { size: '小', color: '黑' },
    },
    {
      id: 12,
      variantLabel: '大 / 黑',
      stock: 2,
      costPrice: 20,
      displayMode: 'layered' as const,
      salesAttributes: { size: '大', color: '黑' },
    },
    {
      id: 11,
      variantLabel: '大 / 白',
      stock: 1,
      costPrice: 10,
      displayMode: 'layered' as const,
      salesAttributes: { size: '大', color: '白' },
    },
  ].map((variant) => ({ ...variant, sizeValue: variant.salesAttributes.size, color: variant.salesAttributes.color }));
  await view.setProps({
    operations: true,
    product: {
      ...product,
      variants,
      specDimensions: [
        { key: 'size', name: '尺寸', values: ['大', '小'] },
        { key: 'color', name: '颜色', values: ['白', '黑'] },
      ],
      guidePrices: variants.map((variant) => ({
        skuId: variant.id,
        costPrice: variant.costPrice,
        priceCoefficient: 2,
        price: variant.costPrice * 2,
      })),
    },
  });
  const vm = view.vm as unknown as {
    columns: { colKey: string; fixed?: string }[];
    rows: { skuId: number; stock: number; cost: number; guide: string }[];
    span: (context: { rowIndex: number; col: { colKey: string } }) => { rowspan?: number; colspan?: number };
  };
  expect(vm.columns.map((column) => column.colKey)).toEqual(['size', 'color', 'cost', 'guide', 'stock']);
  expect(vm.columns.slice(0, 2).every((column) => column.fixed === 'left')).toBe(true);
  expect(vm.rows.map((row) => [row.skuId, row.stock, row.cost, row.guide])).toEqual([
    [11, 1, 10, '2 / 20'],
    [12, 2, 20, '2 / 40'],
    [13, 3, 30, '2 / 60'],
  ]);
  expect(vm.span({ rowIndex: 0, col: { colKey: 'size' } })).toEqual({ rowspan: 2, colspan: 1 });
  expect(vm.span({ rowIndex: 1, col: { colKey: 'size' } })).toEqual({ rowspan: 0, colspan: 0 });
  expect(vm.span({ rowIndex: 1, col: { colKey: 'color' } })).toEqual({ rowspan: 1, colspan: 1 });
  expect(vm.span({ rowIndex: 2, col: { colKey: 'color' } })).toEqual({ rowspan: 1, colspan: 1 });
  expect(vm.span({ rowIndex: 0, col: { colKey: 'guide' } })).toEqual({});
  expect(variants.map((variant) => variant.id)).toEqual([13, 12, 11]);
  await view.setProps({ operations: false });
  expect(vm.rows.map((row) => row.skuId)).toEqual([13, 12, 11]);
  expect(vm.span({ rowIndex: 0, col: { colKey: 'size' } })).toEqual({});
});
