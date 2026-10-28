import { sortByStateActivity } from '@/services/productStateActivity';
import type { SlabOffShelfRecord, SlabStatus } from '@/services/slabs';
import type { FilterState, SlabItem } from './slabPageModel';

export const offShelfTimestamp = (record?: SlabOffShelfRecord) => {
  if (!record?.offShelvedAt) return 0;
  const timestamp = new Date(record.offShelvedAt).getTime();
  return Number.isNaN(timestamp) ? 0 : timestamp;
};

export const latestOffShelfRecord = (row: SlabItem) =>
  row.offShelfRecords.reduce<SlabOffShelfRecord | undefined>((latest, current) => {
    if (!latest) return current;
    const timeDifference = offShelfTimestamp(current) - offShelfTimestamp(latest);
    return timeDifference > 0 || (timeDifference === 0 && current.id > latest.id) ? current : latest;
  }, undefined);

export const filterSlabItems = (items: SlabItem[], activeTab: SlabStatus, filter: FilterState) => {
  const matchedItems = items.filter((item) => {
    const statusMatched = item.status === activeTab;
    const keyword = filter.keyword.trim().toLowerCase();
    const keywordMatched =
      !keyword ||
      String(item.id).includes(keyword) ||
      item.name.toLowerCase().includes(keyword) ||
      item.code.toLowerCase().includes(keyword);
    const varietyMatched = !filter.variety || item.variety === filter.variety;
    const originMatched = !filter.origin || item.origin === filter.origin;
    const textureMatched = !filter.texture || item.texture === filter.texture;
    const colorMatched = !filter.color || item.color === filter.color;
    const gradeMatched = !filter.grade || item.grade === filter.grade;
    const supplierKeyword = filter.supplier.trim().toLowerCase();
    const supplierMatched = !supplierKeyword || item.tenant.toLowerCase().includes(supplierKeyword);
    const latestRecord = latestOffShelfRecord(item);
    const offShelfReasonMatched =
      activeTab !== 'warehouse' || !filter.offShelfReason || latestRecord?.standardReason === filter.offShelfReason;
    const offShelvedByKeyword = filter.offShelvedBy.trim().toLowerCase();
    const offShelvedByMatched =
      activeTab !== 'warehouse' ||
      !offShelvedByKeyword ||
      latestRecord?.offShelvedByName.toLowerCase().includes(offShelvedByKeyword);
    return (
      statusMatched &&
      keywordMatched &&
      varietyMatched &&
      originMatched &&
      textureMatched &&
      colorMatched &&
      gradeMatched &&
      supplierMatched &&
      offShelfReasonMatched &&
      offShelvedByMatched
    );
  });
  return sortByStateActivity(matchedItems);
};
