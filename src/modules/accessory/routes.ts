import { defineComponent, h, provide } from 'vue';
import { commodityScopeKey } from '@/composables/useCommodityModule';
import Management from '@/pages/finished-stock/management/index.vue';
import SupplyChain from '@/pages/finished-stock/supply-chain/index.vue';
import Store from '@/pages/finished-stock/store/index.vue';

// Distinct route components also reset page-local state when switching commodity modules.
function accessoryPage(name: string, component: typeof Management | typeof SupplyChain | typeof Store) {
  return defineComponent({
    name,
    setup() {
      provide(commodityScopeKey, 'accessory');
      return () => h(component);
    },
  });
}
export const AccessoryManagement = accessoryPage('AccessoryManagement', Management);
export const SupplyChainAccessory = accessoryPage('SupplyChainAccessory', SupplyChain);
export const StoreAccessory = accessoryPage('StoreAccessory', Store);
