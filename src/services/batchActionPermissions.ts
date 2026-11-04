const product =
  '((?:admin|supply-chain)\\.(?:finished-stock-management|accessory-management|slab-management)|store\\.(?:finished-stock-management|accessory-management))';
export function canonicalBatchPermission(permission: string): string {
  const shelf = permission.match(new RegExp(`^${product}\\.(?:warehouse\\.)?batch-shelf$`));
  if (shelf) return `${shelf[1]}.warehouse.shelf`;
  const state = permission.match(new RegExp(`^${product}\\.(selling|recycle)\\.batch-(off-shelf|restore|purge)$`));
  if (
    state &&
    ((state[2] === 'selling' && state[3] === 'off-shelf') ||
      (state[2] === 'recycle' && ['restore', 'purge'].includes(state[3])))
  )
    return `${state[1]}.${state[2]}.${state[3]}`;
  return permission.replace(
    /^(store\.customer-management\.(?:daily|archived))\.batch-(archive|restore|purge)$/,
    '$1.$2',
  );
}
