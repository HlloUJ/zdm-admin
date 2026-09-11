import { mount, config } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import FinishedCreationSnapshot from './FinishedCreationSnapshot.vue';
import FinishedSalesLogTable from './FinishedSalesLogTable.vue';

config.global.stubs.SalesLogFullscreen = { template: '<div><slot /></div>' };

describe('creation snapshot layout', () => {
  it('uses editor sections and joins historical prices to ordered SKU rows without inputs', () => {
    const wrapper = mount(FinishedCreationSnapshot, {
      props: {
        snapshot: {
          商品名称: '创建时商品',
          商品分类: '家具',
          供应商: '创建时供应商',
          总库存: 3,
          商家编码: '100',
          状态: 'warehouse',
          商品属性: [{ attributeId: 1, attributeName: '材质', value: '实木' }],
          销售属性名称: { attribute_7: '表面处理' },
          规格维度: [{ key: 'color', name: '颜色', values: ['红', '蓝'] }],
          销售规格: [
            {
              variantKey: 'blue',
              variantLabel: '蓝色',
              displayMode: 'layered',
              stock: 2,
              salesAttributes: { color: '蓝' },
            },
            {
              variantKey: 'red',
              variantLabel: '红色',
              displayMode: 'layered',
              stock: 1,
              salesAttributes: { color: '红', attribute_7: '抛光' },
            },
          ],
          指导价: [{ variantKey: 'red', costPrice: 10, priceCoefficient: 2, price: 20 }],
          层级价格: [
            {
              variantKey: 'red',
              storeLevelId: 1,
              storeLevelName: '一级合伙人',
              priceCoefficient: 1.1,
              price: 11,
              priceSource: 'manual',
            },
          ],
        },
        media: [],
        richText: '<p>创建时详情</p>',
      },
      shallow: true,
      global: {
        stubs: {
          't-table': true,
          FinishedSalesLogTable: false,
          't-space': { template: '<div><slot /></div>' },
          AdminSectionCard: { template: '<section><slot /></section>' },
        },
      },
    });
    expect(wrapper.findAll('h3').map((node) => node.text())).toEqual(['图文描述', '基础信息', '销售信息']);
    const table = wrapper.findComponent({ name: 'TTable' });
    const vm = wrapper.findComponent(FinishedSalesLogTable).vm as unknown as {
      rows: { merchantCode: string; guide?: { price: number }; level_1?: { price: number } }[];
      columns: { title: string }[];
    };
    expect(vm.rows.map((row) => row.merchantCode)).toEqual(['red', 'blue']);
    expect(vm.rows[0].guide?.price).toBe(20);
    expect(vm.rows[0].level_1?.price).toBe(11);
    expect(vm.columns.map((col) => col.title)).toEqual([
      '颜色',
      '成本价',
      '指导价',
      '一级合伙人',
      '数量',
      '表面处理',
      '商家编码',
    ]);
    expect(wrapper.findAll('t-table-stub')).toHaveLength(1);
    expect(wrapper.find('input').exists()).toBe(false);
    expect(wrapper.find('select').exists()).toBe(false);
    expect(table.exists() || wrapper.find('t-table-stub').exists()).toBe(true);
  });
});
