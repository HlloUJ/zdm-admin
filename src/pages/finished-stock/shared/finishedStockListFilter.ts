import { sortByCreatedAtDesc } from '@/services/recordSorting';
import { sortByOffShelfAtDesc } from '../management/offShelfSorting';
import type { FilterState, StockItem, StockStatus } from './finishedStockPageModel';

export const filterFinishedStockItems = (items: StockItem[], activeTab: StockStatus, filter: FilterState) => {
  const keyword = filter.keyword.trim().toLocaleLowerCase();
  const sorted = activeTab === 'offShelf' ? sortByOffShelfAtDesc(items) : sortByCreatedAtDesc(items);
  return sorted.filter((item) => {
    if (item.status !== activeTab) return false;
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
