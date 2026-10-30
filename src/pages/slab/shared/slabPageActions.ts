import type { SlabStatus } from '@/services/slabs';

export type SlabRowAction = 'detail' | 'price' | 'shelf' | 'edit' | 'delete' | 'offShelf' | 'restore' | 'purge';
export type SlabBatchAction =
  'publish' | 'batchShelf' | 'batchOffShelf' | 'batchRestore' | 'batchPurge' | 'clearRecycle';

type PermissionCheck = (status: SlabStatus, action: string) => boolean;
interface BatchButton {
  label: string;
  action: SlabBatchAction;

  icon: string;
  className?: string;
}
interface RowButton {
  label: string;
  action: SlabRowAction;
}

/** Keep labels and ordering shared while each client supplies its own permission check. */
export function slabBatchButtons(status: SlabStatus, hasAction: PermissionCheck): BatchButton[] {
  const map: Record<SlabStatus, BatchButton[]> = {
    warehouse: [
      { label: '发布商品', action: 'publish', icon: 'add' },
      { label: '批量上架', action: 'batchShelf', icon: 'upload' },
    ],
    selling: [
      { label: '发布商品', action: 'publish', icon: 'add' },
      { label: '批量下架', action: 'batchOffShelf', icon: 'download', className: 'brown-button' },
    ],
    soldOut: [],
    recycle: [
      { label: '批量放回到仓库', action: 'batchRestore', icon: 'rollback' },
      { label: '批量彻底删除', action: 'batchPurge', icon: 'delete', className: 'dark-red-button' },
      { label: '清空回收站', action: 'clearRecycle', icon: 'clear' },
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
      { label: '上架', action: 'shelf' },
      { label: '编辑', action: 'edit' },
      { label: '删除', action: 'delete' },
    ]);
  }
  if (status === 'selling') {
    return filterActions([
      { label: '下架', action: 'offShelf' },
      { label: '编辑', action: 'edit' },
      { label: '删除', action: 'delete' },
    ]);
  }
  if (status === 'soldOut') return filterActions([{ label: '详情', action: 'detail' }]);
  return filterActions([
    { label: '详情', action: 'detail' },
    { label: '放回仓库', action: 'restore' },
    { label: '彻底删除', action: 'purge' },
  ]);
}
