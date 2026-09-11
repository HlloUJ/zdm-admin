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
        't-descriptions': { template: '<div><slot /></div>' },
        't-descriptions-item': { template: '<div><slot /></div>' },
        't-table': true,
        't-empty': true,
      },
    },
  });
describe('商品只读详情', () => {
  it('显示下架说明并清理图文中的可执行内容', () => {
    const view = wrapper();
    expect(view.text()).toContain('等待供应商确认');
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
