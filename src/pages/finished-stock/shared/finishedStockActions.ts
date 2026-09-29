export type FinishedStockStatus = 'warehouse' | 'selling' | 'offShelf' | 'soldOut' | 'recycle';
export type FinishedStockAction = 'edit' | 'detail' | 'shelf' | 'offShelf' | 'restore' | 'delete' | 'purge';

export interface FinishedStockActionDefinition {
  id: FinishedStockAction;
  label: string;
  permission: string;
  theme: 'primary' | 'warning' | 'danger';
}

// The three clients share status-specific buttons; permission checks and data calls stay with each client.
export const finishedStockActions: Record<FinishedStockStatus, readonly FinishedStockActionDefinition[]> = {
  warehouse: [
    { id: 'shelf', label: '上架', permission: 'shelf', theme: 'primary' },
    { id: 'edit', label: '编辑', permission: 'edit', theme: 'primary' },
    { id: 'delete', label: '删除', permission: 'delete', theme: 'danger' },
  ],
  selling: [
    { id: 'offShelf', label: '下架', permission: 'off-shelf', theme: 'warning' },
    { id: 'edit', label: '编辑', permission: 'edit', theme: 'primary' },
  ],
  offShelf: [
    { id: 'detail', label: '详情', permission: 'detail', theme: 'primary' },
    { id: 'restore', label: '放回仓库', permission: 'restore', theme: 'primary' },
    { id: 'delete', label: '删除', permission: 'delete', theme: 'danger' },
  ],
  soldOut: [{ id: 'detail', label: '详情', permission: 'detail', theme: 'primary' }],
  recycle: [
    { id: 'detail', label: '详情', permission: 'detail', theme: 'primary' },
    { id: 'restore', label: '放回仓库', permission: 'restore', theme: 'primary' },
    { id: 'purge', label: '彻底删除', permission: 'purge', theme: 'danger' },
  ],
};
