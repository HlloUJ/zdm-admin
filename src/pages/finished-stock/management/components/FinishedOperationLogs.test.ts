import { flushPromises, mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import FinishedOperationLogs from './FinishedOperationLogs.vue';
import FinishedLogValue from './FinishedLogValue.vue';
import ProductOperationLogTemplate from '@/components/product-logs/ProductOperationLogTemplate.vue';
import { getLoginUser } from '@/services/auth';
import { listFinishedOperationLogs, getFinishedOperationLog } from '@/services/finishedOperationLogs';
vi.mock('@/services/auth', async (original) => ({
  ...(await original<typeof import('@/services/auth')>()),
  getLoginUser: vi.fn(() => ({ clientCode: 'admin' })),
}));
vi.mock('@/services/finishedOperationLogs', async (original) => ({
  ...(await original<typeof import('@/services/finishedOperationLogs')>()),
  listFinishedOperationLogs: vi.fn().mockResolvedValue({ records: [], total: 0 }),
  getFinishedOperationLog: vi.fn().mockResolvedValue({
    id: 1,
    productName: '历史商品',
    operatedAt: '2026-09-10T10:00:00',
    operationType: 'CREATE',
    changeDetails: JSON.stringify({
      商品名称: { before: null, after: '历史商品' },
      宝贝详情: {
        before: null,
        after: '<p>历史详情</p><img src="media:2"><video src="media:3" controls></video><script>alert(1)</script>',
      },
      媒体: {
        before: null,
        after: [
          {
            field: 'mainImage',
            mediaId: 1,
            resource: { available: true, mediaType: 'image', url: '/api/open/media/main' },
          },
          {
            field: 'detailMedia2',
            mediaId: 2,
            resource: { available: true, mediaType: 'image', url: '/api/open/media/detail-image' },
          },
          {
            field: 'detailMedia3',
            mediaId: 3,
            resource: { available: true, mediaType: 'video', url: '/api/open/media/detail-video' },
          },
          {
            field: 'video',
            mediaId: 4,
            resource: { available: true, mediaType: 'video', url: '/api/open/media/product-video' },
          },
        ],
      },
    }),
  }),
}));
vi.mock('@/components/foundation', () => ({
  AdminDialog: { template: '<div><slot /></div>' },
  AdminPagination: { template: '<div />' },
  adminFeedback: { error: vi.fn() },
}));
describe('finished operation logs', () => {
  it('keeps supplier source filters on operations only', () => {
    const optionValues = (clientCode: 'admin' | 'supply-chain') => {
      vi.mocked(getLoginUser).mockReturnValue({ clientCode } as ReturnType<typeof getLoginUser>);
      const wrapper = mount(FinishedOperationLogs, { props: { visible: false }, shallow: true });
      return (wrapper.findComponent(ProductOperationLogTemplate).props('typeOptions') as { value: string }[]).map(
        ({ value }) => value,
      );
    };
    const sourceTypes = ['SOURCE_SHELF', 'SOURCE_OFF_SHELF', 'SOURCE_DELETE_TO_RECYCLE', 'SOURCE_PURGE'];
    const supplyOptions = optionValues('supply-chain');
    for (const type of sourceTypes) expect(supplyOptions).not.toContain(type);
    expect(optionValues('admin')).toEqual(expect.arrayContaining(sourceTypes));
  });
  it('loads on opening and reads persisted details without editable fields', async () => {
    const wrapper = mount(FinishedOperationLogs, {
      props: { visible: false },
      shallow: true,
      global: {
        stubs: { 't-space': { template: '<div><slot /></div>' }, AdminDialog: { template: '<div><slot /></div>' } },
      },
    });
    await wrapper.setProps({ visible: true });
    await flushPromises();
    expect(listFinishedOperationLogs).toHaveBeenCalledWith(expect.objectContaining({ page: 1, pageSize: 10 }));
    const vm = wrapper.vm as unknown as {
      showDetail: (id: number) => Promise<void>;
      richText: (side: 'after') => string;
      time: (value: string) => string;
    };
    await vm.showDetail(1);
    expect(getFinishedOperationLog).toHaveBeenCalledWith(1);
    expect(vm.time('2026-09-10T09:48:20')).toBe('2026/09/10 17:48');
    expect(vm.richText('after')).toContain('历史详情');
    expect(vm.richText('after')).not.toContain('<script');
    expect(vm.richText('after')).toContain('/api/open/media/detail-image');
    expect(vm.richText('after')).toContain('/api/open/media/detail-video');
    expect(wrapper.find('input').exists()).toBe(false);
  });
  it('shows price origin changes using business labels', () => {
    const wrapper = mount(FinishedLogValue, { props: { value: { priceSource: 'auto', stock: 0 } } });
    expect(wrapper.text()).toContain('价格来源：跟随配置');
    expect(wrapper.text()).toContain('库存：0');
  });
});
