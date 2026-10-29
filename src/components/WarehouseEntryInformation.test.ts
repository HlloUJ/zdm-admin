import type { DefineComponent } from 'vue';
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import WarehouseEntryInformation from './WarehouseEntryInformation.vue';
const render = (entry: Record<string, string | null>) =>
  mount(
    WarehouseEntryInformation as unknown as DefineComponent<InstanceType<typeof WarehouseEntryInformation>['$props']>,
    {
      props: { entry },
      global: {
        stubs: {
          't-space': { template: '<div><slot /></div>' },
          't-tag': { template: '<span data-test="tag"><slot /></span>' },
          't-tooltip': { template: '<span><slot /></span>' },
        },
      },
    },
  );
describe('current warehouse entry presentation', () => {
  for (const [type, label] of [
    ['firstEntry', '首次入库'],
    ['recycleRestore', '回收恢复'],
  ]) {
    it(`${type} shows only its tag and never stale reasons or a placeholder`, () => {
      const view = render({ warehouseEntryType: type, warehouseEntryReason: '旧原因', warehouseEntryDetail: '旧说明' });
      expect(view.text()).toBe(label);
      expect(view.findAll('[data-test="tag"]')).toHaveLength(1);
    });
  }
  it('shows down reason and the confirmed detail fallback without substituting it into business data', () => {
    const entry = { warehouseEntryType: 'offShelf', warehouseEntryReason: '价格调整', warehouseEntryDetail: null };
    const view = render(entry);
    expect(view.text()).toContain('下架入库');
    expect(view.text()).toContain('价格调整');
    expect(view.text()).toContain('未填写详细说明');
    expect(view.text()).not.toContain('—');
    expect(entry.warehouseEntryDetail).toBeNull();
  });
  it('shows actual detail and never guesses first entry from missing provenance', () => {
    expect(render({ warehouseEntryType: 'offShelf', warehouseEntryDetail: '核对规格' }).text()).toContain('核对规格');
    expect(render({ warehouseEntryType: null }).text()).toBe('历史入库');
  });
});
