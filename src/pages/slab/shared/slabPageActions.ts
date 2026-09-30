import type { SlabStatus } from '@/services/slabs';

export type SlabRowAction = 'detail' | 'price' | 'shelf' | 'edit' | 'delete' | 'offShelf' | 'restore' | 'purge';
export type SlabBatchAction =
  'publish' | 'batchShelf' | 'batchOffShelf' | 'batchRestore' | 'batchPurge' | 'clearRecycle';

type PermissionCheck = (status: SlabStatus, action: string) => boolean;
interface BatchButton {
  label: string;
  action: SlabBatchAction;
  theme: 'primary' | 'danger' | 'default';
  icon: string;
  className?: string;
}
interface RowButton {
  label: string;
  action: SlabRowAction;
  theme: 'primary' | 'warning' | 'danger' | 'default';
}

/** Keep labels and ordering shared while each client supplies its own permission check. */
export function slabBatchButtons(status: SlabStatus, hasAction: PermissionCheck): BatchButton[] {
  const map: Record<SlabStatus, BatchButton[]> = {
    warehouse: [
      { label: '发布商品', action: 'publish', theme: 'primary', icon: 'add' },
      { label: '批量上架', action: 'batchShelf', theme: 'primary', icon: 'upload' },
    ],
    selling: [
      { label: '发布商品', action: 'publish', theme: 'primary', icon: 'add' },
      { label: '批量下架', action: 'batchOffShelf', theme: 'default', icon: 'download', className: 'brown-button' },
    ],
    offShelf: [{ label: '批量放回到仓库', action: 'batchRestore', theme: 'primary', icon: 'rollback' }],
    soldOut: [],
    recycle: [
      { label: '批量放回到仓库', action: 'batchRestore', theme: 'primary', icon: 'rollback' },
      { label: '批量彻底删除', action: 'batchPurge', theme: 'danger', icon: 'delete', className: 'dark-red-button' },
      { label: '清空回收站', action: 'clearRecycle', theme: 'danger', icon: 'clear' },
    ],
  };
  const permissions: Record<SlabBatchAction, string> = {
    publish: 'publish',
    batchShelf: 'batch-shelf',
    batchOffShelf: 'batch-off-shelf',
    batchRestore: 'batch-restore',
    batchPurge: 'batch-purge',
    clearRecycle: 'clear',
  };
  return map[status].filter((button) => hasAction(status, permissions[button.action]));
}

export function slabRowButtons(status: SlabStatus, hasAction: PermissionCheck): RowButton[] {
  const permissions: Record<SlabRowAction, string> = {
    detail: 'detail',
    price: 'price',
    shelf: 'shelf',
    edit: 'edit',
    delete: 'delete',
    offShelf: 'off-shelf',
    restore: 'restore',
    purge: 'purge',
  };
  const filterActions = (actions: RowButton[]) =>
    actions.filter((action) => hasAction(status, permissions[action.action]));
  if (status === 'warehouse') {
    return filterActions([
      { label: '上架', action: 'shelf', theme: 'primary' },
      { label: '编辑', action: 'edit', theme: 'primary' },
      { label: '删除', action: 'delete', theme: 'danger' },
    ]);
  }
  if (status === 'selling') {
    return filterActions([
      { label: '下架', action: 'offShelf', theme: 'warning' },
      { label: '编辑', action: 'edit', theme: 'primary' },
    ]);
  }
  if (status === 'offShelf') {
    return filterActions([
      { label: '详情', action: 'detail', theme: 'primary' },
      { label: '放回仓库', action: 'restore', theme: 'primary' },
      { label: '删除', action: 'delete', theme: 'danger' },
    ]);
  }
  if (status === 'soldOut') return filterActions([{ label: '详情', action: 'detail', theme: 'primary' }]);
  return filterActions([
    { label: '详情', action: 'detail', theme: 'primary' },
    { label: '放回仓库', action: 'restore', theme: 'primary' },
    { label: '彻底删除', action: 'purge', theme: 'danger' },
  ]);
}
