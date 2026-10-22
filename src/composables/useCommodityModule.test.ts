import { afterEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { defineComponent, h } from 'vue';
import { commodityScopeKey, useCommodityModule, type CommodityScope } from './useCommodityModule';
import { fullFunctionCatalog, terminalFunctionTrees } from '@/services/functionCatalog';

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('commodity module isolation', () => {
  it.each(['finished', 'accessory'] as const)(
    '%s uses its own product, price, store and log endpoints',
    async (scope: CommodityScope) => {
      const fetcher = vi
        .fn<typeof fetch>()
        .mockResolvedValue({ ok: true, json: async () => ({ code: 0, data: [] }) } as Response);
      vi.stubGlobal('fetch', fetcher);
      let module!: ReturnType<typeof useCommodityModule>;
      const Child = defineComponent({
        setup() {
          module = useCommodityModule();
          return () => h('div');
        },
      });
      const wrapper = mount(Child, { global: { provide: { [commodityScopeKey as symbol]: scope } } });
      await module.products.listFinishedProducts();
      await module.pricing.getFinishedGuidePriceSetting();
      await module.store.listStoreFinishedProducts();
      await module.logs.getFinishedOperationLog(1);
      expect(fetcher.mock.calls.map((call) => String(call[0]))).toEqual([
        `/api/admin/${scope}-products`,
        `/api/admin/${scope}-guide-price-setting`,
        `/api/admin/store-${scope}-products`,
        `/api/admin/${scope}-products/operation-logs/1`,
      ]);
      expect(module.moduleKey).toBe(scope === 'accessory' ? 'accessory-management' : 'finished-stock-management');
      wrapper.unmount();
    },
  );

  it('registers exact counterpart resources for all three clients', () => {
    const normalize = (value: unknown) =>
      JSON.parse(
        JSON.stringify(value)
          .replaceAll('finished-stock-management', 'accessory-management')
          .replaceAll('成品现货', '配件'),
      );
    const store = terminalFunctionTrees.store;
    expect(store.find((m) => m.value === 'store.accessory-management')).toEqual(
      normalize(store.find((m) => m.value === 'store.finished-stock-management')),
    );
    for (const [catalog, prefix] of [
      [fullFunctionCatalog, 'admin'],
      [terminalFunctionTrees['supply-chain'], 'supply-chain'],
    ] as const) {
      const menus = catalog.flatMap((m) => m.menus);
      expect(menus.find((m) => m.value === `${prefix}.accessory-management.menu`)).toEqual(
        normalize(menus.find((m) => m.value === `${prefix}.finished-stock-management.menu`)),
      );
    }
    const pricePage = fullFunctionCatalog
      .flatMap((m) => m.menus)
      .flatMap((m) => m.pages)
      .find((p) => p.value === 'admin.product-data-center.markup-configuration')!;
    const accessory = pricePage.tabs.find((t) => t.value.endsWith('.accessory'))!;
    const finished = pricePage.tabs.find((t) => t.value.endsWith('.finished'))!;
    expect(accessory).toEqual(
      JSON.parse(
        JSON.stringify(finished).replaceAll('.finished', '.accessory').replaceAll('成品价格配置', '配件价格配置'),
      ),
    );
  });
});
