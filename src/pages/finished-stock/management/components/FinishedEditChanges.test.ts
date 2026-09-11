import { mount, config } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import FinishedEditChanges from './FinishedEditChanges.vue';
import FinishedLogValue from './FinishedLogValue.vue';
import FinishedSalesLogTable from './FinishedSalesLogTable.vue';
config.global.stubs.SalesLogFullscreen = { template: '<div><slot /></div>' };

describe('edit log layout', () => {
  it('orders changes by edit sections, pairs changed media, and gives wide data full width', () => {
    const media = { field: 'mainImage', mediaId: 1, resource: { available: true, mediaType: 'image', url: '/old' } };
    const next = { ...media, mediaId: 2, resource: { ...media.resource, url: '/new' } };
    const video = { field: 'video', mediaId: 3 };
    const wrapper = mount(FinishedEditChanges, {
      shallow: true,
      props: {
        changes: {
          商家编码: { before: 'old', after: 'new' },
          销售规格: { before: [{ variantLabel: '规格1', stock: 1 }], after: [{ variantLabel: '规格1', stock: 2 }] },
          商品名称: { before: '旧名称', after: '新名称' },
          媒体: { before: [media, video], after: [next, video] },
        },
        media: [media, next],
        beforeHtml: '',
        afterHtml: '',
      },
    });
    expect(wrapper.findAll('.change-section-title').map((el) => el.text().replace(/\s+/g, ''))).toEqual([
      '图文描述',
      '基础信息',
      '销售信息',
    ]);
    expect(wrapper.findAll('h4').map((el) => el.text())).toEqual(['商品主图1', '商品名称', '销售规格', '商家编码']);
    expect(wrapper.find('.change-summary').text().replace(/\s+/g, '')).toBe('变更对比4项');
    expect(wrapper.text()).not.toContain('点击查看大图');
    expect(wrapper.findAll('.change-side--media')).toHaveLength(2);
    expect(wrapper.findAll('.change-pair--wide')).toHaveLength(1);
    expect(wrapper.findAllComponents(FinishedLogValue).map((c) => c.props('value'))).toContain('新名称');
    expect(wrapper.find('input').exists()).toBe(false);
    wrapper.findAll('button')[1].trigger('click');
    expect(wrapper.emitted('preview')?.[0]).toEqual([next.resource]);
  });
  it('places rich-text versions side by side in separate scroll regions', () => {
    const wrapper = mount(FinishedEditChanges, {
      shallow: true,
      props: {
        changes: { 宝贝详情: { before: '<p>旧详情</p>', after: '<p>新详情</p>' } },
        media: [],
        beforeHtml: '<p>旧详情</p>',
        afterHtml: '<p>新详情</p>',
      },
    });
    expect(wrapper.findAll('.change-pair--wide')).toHaveLength(0);
    expect(wrapper.findAll('.change-rich-scroll')).toHaveLength(2);
    expect(wrapper.findAll('.change-rich-scroll').map((el) => el.attributes('aria-label'))).toEqual([
      '宝贝详情修改前',
      '宝贝详情修改后',
    ]);
    expect(wrapper.findAll('historical-rich-text-stub').map((el) => el.attributes('html'))).toEqual([
      '<p>旧详情</p>',
      '<p>新详情</p>',
    ]);
  });
  it('exposes saved cost, guide and partner price changes under explicit headings', () => {
    const wrapper = mount(FinishedEditChanges, {
      shallow: true,
      props: {
        changes: {
          指导价: {
            before: [{ variantLabel: '规格1', variantKey: '1', costPrice: 1000, price: 5000 }],
            after: [{ variantLabel: '规格1', variantKey: '11', costPrice: 1200, price: 6000 }],
          },
          层级价格: {
            before: [{ variantLabel: '规格1', costPrice: 1000, price: 1100, storeLevelName: '1级合伙人' }],
            after: [{ variantLabel: '规格1', costPrice: 1200, price: 1320, storeLevelName: '1级合伙人' }],
          },
        },
        media: [],
        beforeHtml: '',
        afterHtml: '',
      },
    });
    expect(wrapper.findAll('h4').map((el) => el.text())).toEqual(['销售规格']);
    const tables = wrapper.findAllComponents(FinishedSalesLogTable);
    expect(tables).toHaveLength(2);
    expect(tables[0].props('snapshot')['指导价'][0].costPrice).toBe(1000);
    expect(tables[1].props('snapshot')['指导价'][0].costPrice).toBe(1200);
    expect(tables[0].props('snapshot')['层级价格'][0].price).toBe(1100);
    expect(tables[1].props('snapshot')['层级价格'][0].price).toBe(1320);
  });
  it('hides unchanged sections and retains uncommon historical fields', () => {
    const wrapper = mount(FinishedEditChanges, {
      shallow: true,
      props: {
        changes: { 发布类型: { before: '旧', after: '新' } },
        media: [],
        beforeHtml: '',
        afterHtml: '',
      },
    });
    expect(wrapper.findAll('.change-section-title').map((el) => el.text())).toEqual(['其他信息']);
    expect(wrapper.text()).not.toContain('本次未修改此部分');
    expect(wrapper.findAll('h4').map((el) => el.text())).toEqual(['发布类型']);
  });
  it('synchronizes horizontal scrolling in both directions without changing vertical position', async () => {
    const wrapper = mount(FinishedEditChanges, {
      shallow: true,
      props: {
        changes: { 销售规格: { before: [{ variantKey: 'a' }], after: [{ variantKey: 'a' }] } },
        media: [],
        beforeHtml: '',
        afterHtml: '',
      },
      global: {
        stubs: {
          FinishedSalesLogTable: {
            template: '<div class="sales-log-table"><div class="t-table__content"></div></div>',
          },
        },
      },
    });
    const [before, after] = wrapper.findAll('.t-table__content');
    const first = before.element as HTMLElement;
    const second = after.element as HTMLElement;
    expect(wrapper.findAll('.sales-shared-scroll')).toHaveLength(1);
    const shared = wrapper.find('.sales-shared-scroll');
    (shared.element as HTMLElement).scrollLeft = 60;
    await shared.trigger('scroll');
    expect(first.scrollLeft).toBe(60);
    expect(second.scrollLeft).toBe(60);
    second.scrollTop = 25;
    first.scrollLeft = 120;
    await before.trigger('scroll');
    expect(second.scrollLeft).toBe(120);
    expect(second.scrollTop).toBe(25);
    second.scrollLeft = 240;
    await after.trigger('scroll');
    expect(first.scrollLeft).toBe(240);
    await before.trigger('scroll');
    expect(second.scrollLeft).toBe(240);
  });
  it.each([false, true])(
    'scrolls each table independently when display mode changes (reverse: %s)',
    async (reverse) => {
      const layered = [{ key: 'color', name: '颜色', values: ['白色'] }];
      const wrapper = mount(FinishedEditChanges, {
        shallow: true,
        props: {
          changes: {
            销售规格: { before: [{ variantKey: 'a' }], after: [{ variantKey: 'a' }] },
            规格维度: { before: reverse ? layered : [], after: reverse ? [] : layered },
          },
          media: [],
          beforeHtml: '',
          afterHtml: '',
        },
        global: {
          stubs: {
            FinishedSalesLogTable: {
              template: '<div class="sales-log-table"><div class="t-table__content"></div></div>',
            },
          },
        },
      });
      expect(wrapper.find('.sales-shared-scroll').exists()).toBe(false);
      expect(wrapper.find('.change-pair--sales-synced').exists()).toBe(false);
      const [before, after] = wrapper.findAll('.t-table__content');
      (before.element as HTMLElement).scrollLeft = 120;
      await before.trigger('scroll');
      expect((after.element as HTMLElement).scrollLeft).toBe(0);
      (after.element as HTMLElement).scrollLeft = 240;
      await after.trigger('scroll');
      expect((before.element as HTMLElement).scrollLeft).toBe(120);
    },
  );
});
