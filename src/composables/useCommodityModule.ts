import { inject, type InjectionKey } from 'vue';
import * as finishedProducts from '@/services/finishedProducts';
import * as accessoryProducts from '@/services/accessoryProducts';
import * as finishedPricing from '@/services/finishedMarkupConfigurations';
import * as accessoryPricing from '@/services/accessoryMarkupConfigurations';
import * as finishedStore from '@/services/storeFinishedStock';
import * as accessoryStore from '@/services/storeAccessoryStock';
import * as finishedLogs from '@/services/finishedOperationLogs';
import * as accessoryLogs from '@/services/accessoryOperationLogs';

export type CommodityScope = 'finished' | 'accessory';
export const commodityScopeKey: InjectionKey<CommodityScope> = Symbol('commodityScope');
export function useCommodityModule() {
  const scope = inject(commodityScopeKey, 'finished');
  const accessory = scope === 'accessory';
  return {
    scope,
    label: accessory ? '配件' : '成品现货',
    shortLabel: accessory ? '配件' : '成品',
    moduleKey: accessory ? 'accessory-management' : 'finished-stock-management',
    storeEditRoute: accessory ? 'storeAccessoryEdit' : 'storeFinishedStockEdit',
    storeListRoute: accessory ? 'storeAccessoryManagement' : 'storeFinishedStockManagement',
    products: accessory ? accessoryProducts : finishedProducts,
    pricing: accessory ? accessoryPricing : finishedPricing,
    store: accessory ? accessoryStore : finishedStore,
    logs: accessory ? accessoryLogs : finishedLogs,
  };
}
