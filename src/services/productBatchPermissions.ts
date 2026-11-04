export function canBatchDelete(
  tab: string,
  hasStateAction: (state: 'warehouse' | 'selling', action: string) => boolean,
): boolean {
  if (tab === 'all') return hasStateAction('warehouse', 'delete') && hasStateAction('selling', 'delete');
  return (tab === 'warehouse' || tab === 'selling') && hasStateAction(tab, 'delete');
}
