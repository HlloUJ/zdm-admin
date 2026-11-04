export interface WarehouseEntryInformation {
  warehouseEntryType?: string | null;
  warehouseEntryReason?: string | null;
  warehouseEntryDetail?: string | null;
}
export const warehouseEntryTypes = [
  { value: 'createEntry', label: '创建入库' },
  { value: 'sourceShelfEntry', label: '供应链上架入库' },
  { value: 'productCenterSelect', label: '商品中心选入' },
  { value: 'offShelf', label: '下架入库' },
  { value: 'recycleRestore', label: '回收恢复' },
];
export function warehouseEntryLabel(type?: string | null) {
  return warehouseEntryTypes.find((item) => item.value === type)?.label || '';
}
