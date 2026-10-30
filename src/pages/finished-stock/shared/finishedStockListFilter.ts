import { isAllProductStatus, sortProductsByCreation } from '@/services/productAllView';
import { sortByStateActivity } from '@/services/productStateActivity';
import type { FilterState, StockItem, StockTab } from './finishedStockPageModel';

export const filterFinishedStockItems = (
  items: StockItem[],
  activeTab: StockTab,
  filter: FilterState,
  descending = true,
) => {
  const keyword = filter.keyword.trim().toLocaleLowerCase();
  const sorted =
    activeTab === 'all' ? sortProductsByCreation(items, descending) : sortByStateActivity(items, descending);
  return sorted.filter((item) => {
    if (activeTab === 'all' ? !isAllProductStatus(item.status) : item.status !== activeTab) return false;
    if (
      keyword &&
      ![item.name, String(item.id), item.code].some((value) => value.toLocaleLowerCase().includes(keyword))
    )
      return false;
    if (filter.category && item.category !== filter.category) return false;
    if (filter.supplier && item.supplier !== filter.supplier) return false;
    return true;
  });
};
