import { mount } from '@vue/test-utils';
import { isVNode, type VNode } from 'vue';
import { afterEach, expect, it, vi } from 'vitest';
import FinishedSalesLogTable from './FinishedSalesLogTable.vue';
import { priceLogSnapshot } from '../priceLogSnapshot';
const user = vi.hoisted(() => ({ clientCode: 'admin' }));
vi.mock('@/services/auth', () => ({ getLoginUser: () => user }));
afterEach(() => {
  user.clientCode = 'admin';
});
const snapshot = (source?: string) => ({
  销售规格: [{ skuId: 1, variantLabel: '历史规格', costPrice: 10, stock: 2 }],
  指导价: [{ skuId: 1, costPrice: 10, priceCoefficient: 2, price: 20, ...(source ? { priceSource: source } : {}) }],
});
function setup(source?: string, other?: string, storeMode = false) {
  const wrapper = mount(FinishedSalesLogTable, {
    shallow: true,
    props: {
      snapshot: snapshot(source),
      other: snapshot(other),
      highlightChanges: true,
      storeMode,
    },
  });
  const vm = wrapper.vm as unknown as {
    rows: Record<string, unknown>[];
    columns: { colKey: string; cell: (render: null, context: { row: Record<string, unknown> }) => VNode }[];
  };
  const cell = (key: string) => vm.columns.find((column) => column.colKey === key)!.cell(null, { row: vm.rows[0]! });
  return { wrapper, vm, cell };
}
function badges(node: unknown): VNode[] {
  if (!isVNode(node)) return [];
  if (node.props?.readonly === true && Object.hasOwn(node.props, 'source')) return [node];
  return Array.isArray(node.children) ? node.children.flatMap(badges) : [];
}
it.each(['auto', 'manual'])('shows only the recorded %s guide mode with a readonly badge', (source) => {
  const { wrapper, cell } = setup(source, source);
  const sourceBadges = badges(cell('guide'));
  expect(sourceBadges).toHaveLength(1);
  expect(sourceBadges[0]!.props).toMatchObject({ source, readonly: true, available: false });
  expect(cell('guide').props!.class.split(' ').includes('sales-value-changed')).toBe(false);
  wrapper.unmount();
});
it('highlights a mode-only change while retaining the recorded coefficient and price on both sides', () => {
  for (const [source, other] of [
    ['auto', 'manual'],
    ['manual', 'auto'],
  ]) {
    const { wrapper, vm, cell } = setup(source, other);
    expect(cell('guide').props!.class.split(' ').includes('sales-value-changed')).toBe(true);
    expect(cell('cost').props!.class.split(' ').includes('sales-value-changed')).toBe(false);
    expect(vm.rows[0]!.guide).toMatchObject({ priceCoefficient: 2, price: 20, priceSource: source });
    expect(badges(cell('guide'))[0]!.props!.source).toBe(source);
    wrapper.unmount();
  }
});
it('does not infer a missing historical mode and leaves store and supply-chain presentation unchanged', () => {
  const legacy = setup();
  expect(badges(legacy.cell('guide'))).toHaveLength(0);
  expect(legacy.cell('guide').props!.class.split(' ').includes('sales-value-changed')).toBe(false);
  legacy.wrapper.unmount();
  user.clientCode = 'store';
  const store = setup('auto', 'manual', true);
  expect(badges(store.cell('guide'))).toHaveLength(0);
  expect(store.cell('guide').props!.class.split(' ').includes('sales-value-changed')).toBe(false);
  store.wrapper.unmount();
  user.clientCode = 'supply-chain';
  const supplier = setup('auto', 'manual');
  expect(supplier.vm.columns.some((column) => column.colKey === 'guide')).toBe(false);
  supplier.wrapper.unmount();
});
it('preserves a saved lifecycle price_source when adapting historical SQL snapshots', () => {
  const adapted = priceLogSnapshot([
    { sku_id: 1, variant_label: '历史规格', cost_price: 10, price_coefficient: 2, price: 20, price_source: 'manual' },
  ]);
  expect(adapted['指导价']).toEqual([expect.objectContaining({ priceSource: 'manual', price: 20 })]);
});
