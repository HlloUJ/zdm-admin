export type FinishedStockStatus = 'warehouse' | 'selling' | 'soldOut' | 'recycle';
export type FinishedStockAction = 'edit' | 'detail' | 'shelf' | 'offShelf' | 'restore' | 'delete' | 'purge';

export interface FinishedStockActionDefinition {
  id: FinishedStockAction;
  label: string;
  permission: string;
}

// The three clients share status-specific buttons; permission checks and data calls stay with each client.
export const finishedStockActions: Record<FinishedStockStatus, readonly FinishedStockActionDefinition[]> = {
  warehouse: [
    { id: 'shelf', label: '上架', permission: 'shelf' },
    { id: 'edit', label: '编辑', permission: 'edit' },
    { id: 'delete', label: '删除', permission: 'delete' },
  ],
  selling: [
    { id: 'offShelf', label: '下架', permission: 'off-shelf' },
    { id: 'edit', label: '编辑', permission: 'edit' },
    { id: 'delete', label: '删除', permission: 'delete' },
  ],
  soldOut: [{ id: 'detail', label: '详情', permission: 'detail' }],
  recycle: [
    { id: 'detail', label: '详情', permission: 'detail' },
    { id: 'restore', label: '放回仓库', permission: 'restore' },
    { id: 'purge', label: '彻底删除', permission: 'purge' },
  ],
};
