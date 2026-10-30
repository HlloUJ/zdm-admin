// Only existing product-wide entry actions; state actions retain their own grants.
export const isProductGlobalAction = (permission: string) =>
  /^(admin|supply-chain)\.(finished-stock-management|accessory-management|slab-management)\.batch-shelf$/.test(
    permission,
  ) ||
  /^store\.(finished-stock-management|accessory-management)\.batch-shelf$/.test(permission) ||
  /^supply-chain\.(finished-stock-management|accessory-management|slab-management)\.publish$/.test(permission) ||
  /^store\.(finished-stock-management|accessory-management)\.select$/.test(permission);

export const expandLegacyProductGlobalPermission = (permission: string): string[] | undefined => {
  const batch = permission.match(
    /^((?:admin|supply-chain)\.(?:finished-stock-management|accessory-management|slab-management)|store\.(?:finished-stock-management|accessory-management))\.warehouse\.batch-shelf$/,
  );
  if (batch) return [permission, `${batch[1]}.warehouse.view`, `${batch[1]}.batch-shelf`];
  const match = permission.match(
    /^(supply-chain\.(?:finished-stock-management|accessory-management|slab-management))\.(warehouse|selling)\.publish$|^(store\.(?:finished-stock-management|accessory-management))\.(warehouse)\.select$/,
  );
  if (!match) return undefined;
  const prefix = match[1] || match[3];
  const scope = match[2] || match[4];
  // Preserve the view implied by the old action, without granting other state views or shelving.
  return [`${prefix}.${scope}.view`, `${prefix}.${match[1] ? 'publish' : 'select'}`];
};
