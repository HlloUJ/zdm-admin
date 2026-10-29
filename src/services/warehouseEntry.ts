export interface WarehouseEntryInformation {
  warehouseEntryType?: string | null;
  warehouseEntryReason?: string | null;
  warehouseEntryDetail?: string | null;
}
export const warehouseEntryTypes = [
  { value: 'firstEntry', label: '首次入库' },
  { value: 'offShelf', label: '下架入库' },
  { value: 'recycleRestore', label: '回收恢复' },
  { value: 'sourceReentry', label: '重新入库' },
  { value: 'editReturn', label: '编辑入库' },
];
export function warehouseEntryLabel(type?: string | null) {
  return warehouseEntryTypes.find((item) => item.value === type)?.label || '历史入库';
}
