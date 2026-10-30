import { mount } from '@vue/test-utils';
import { expect, it } from 'vitest';
import OperationsBatchShelfResult from './OperationsBatchShelfResult.vue';
import { AdminDialog } from '@/components/foundation';
it('shows grouped two-column failures and acknowledgement only closes the result', () => {
  const result = {
    total: 4,
    successCount: 1,
    failureCount: 3,
    failures: [
      { id: 61, code: 'SOURCE', reason: '供应链已下架该商品' },
      { id: 62, code: 'SOURCE', reason: '供应链已下架该商品' },
      { id: 64, code: 'STATE', reason: '已处于上架状态，不能重复上架' },
    ],
  };
  const view = mount(OperationsBatchShelfResult, { props: { visible: true, result }, shallow: true });
  const dialog = view.findComponent(AdminDialog);
  expect(dialog.props('confirmation')).toEqual({ kind: 'acknowledgement', action: 'productBatchShelfResult' });
  const vm = view.vm as unknown as { rows: { productIds: string }[]; columns: { title: string }[] };
  expect(vm.rows.map((row) => row.productIds)).toEqual(['61、62', '64']);
  expect(vm.columns.map((col) => col.title)).toEqual(['商品ID', '失败原因']);
  dialog.vm.$emit('confirm');
  expect(view.emitted('update:visible')).toEqual([[false]]);
  expect(result.successCount).toBe(1);
});
