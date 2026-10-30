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
          't-tooltip': {
            props: ['content', 'disabled'],
            template: '<span :data-full-text="content" :data-disabled="String(disabled)"><slot /></span>',
          },
          't-typography-text': { props: ['content', 'ellipsis', 'theme'], template: '<span>{{ content }}</span>' },
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
    expect(view.find('[data-entry-detail]').text()).toBe('价格调整；未填写详细说明');
    expect(view.find('[data-full-text]').attributes('data-full-text')).toBe('价格调整；未填写详细说明');
    expect(view.text()).not.toContain('—');
    expect(view.find('[data-full-text]').attributes('data-disabled')).toBe('true');
    expect(entry.warehouseEntryDetail).toBeNull();
  });
  it('shows a hyphen based only on an empty entry type, without mutating the fields', () => {
    for (const type of [null, '', '   ']) {
      const entry = { warehouseEntryType: type, warehouseEntryReason: '残留原因', warehouseEntryDetail: '残留说明' };
      const view = render(entry);
      expect(view.text()).toBe('-');
      expect(view.findAll('[data-test="tag"]')).toHaveLength(0);
      expect(view.find('[data-full-text]').exists()).toBe(false);
      expect(entry.warehouseEntryReason).toBe('残留原因');
      expect(entry.warehouseEntryDetail).toBe('残留说明');
    }
    expect(render({}).text()).toBe('-');
  });
  it('shows actual detail and never guesses first entry from missing provenance', () => {
    expect(render({ warehouseEntryType: 'offShelf', warehouseEntryDetail: '核对规格' }).text()).toContain('核对规格');
    for (const type of ['sourceReentry', 'editReturn', 'unknown']) {
      const view = render({ warehouseEntryType: type });
      expect(view.findAll('[data-test="tag"]')).toHaveLength(0);
      expect(view.text()).toBe('');
    }
  });
});
