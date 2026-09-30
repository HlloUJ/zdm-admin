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
      activeTab !== 'offShelf' || !filter.offShelfReason || latestRecord?.standardReason === filter.offShelfReason;
    const offShelvedByKeyword = filter.offShelvedBy.trim().toLowerCase();
    const offShelvedByMatched =
      activeTab !== 'offShelf' ||
      !offShelvedByKeyword ||
      latestRecord?.offShelvedByName.toLowerCase().includes(offShelvedByKeyword);
    const [offShelfStartDate, offShelfEndDate] = filter.offShelfDateRange;
    const offShelfTime = offShelfTimestamp(latestRecord);
    const offShelfDateMatched =
      activeTab !== 'offShelf' ||
      ((!offShelfStartDate || offShelfTime >= new Date(`${offShelfStartDate}T00:00:00`).getTime()) &&
        (!offShelfEndDate || offShelfTime <= new Date(`${offShelfEndDate}T23:59:59.999`).getTime()));
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
      offShelvedByMatched &&
      offShelfDateMatched
    );
  });
  if (activeTab !== 'offShelf') return matchedItems;
  return matchedItems.sort((left, right) => {
    const leftRecord = latestOffShelfRecord(left);
    const rightRecord = latestOffShelfRecord(right);
    const timeDifference = offShelfTimestamp(rightRecord) - offShelfTimestamp(leftRecord);
    return timeDifference || (rightRecord?.id ?? 0) - (leftRecord?.id ?? 0) || right.id - left.id;
  });
};
