const legacyScopedPermissionPrefixes = [
  'admin.product-data-center.attribute',
  'admin.product-data-center.attribute-value',
] as const;
const attributeScopes = ['shared', 'finished', 'accessory'] as const;
const categoryStatusPermissionPrefixes = [
  'admin.tenant.store-category-management',
  'admin.product-data-center.category.finished',
  'admin.product-data-center.category.accessory',
] as const;

const legacyAttributeActionMap: Record<string, string> = {
  view: 'view',
  query: 'view',
  查询: 'view',
  create: 'create',
  edit: 'toggle-status',
  'toggle-status': 'toggle-status',
  delete: 'delete',
};

export const expandLegacyScopedPermission = (permission: string) => {
  const legacyCategoryStatusPrefix = categoryStatusPermissionPrefixes.find(
    (candidate) => permission === `${candidate}.disable` || permission === `${candidate}.enable`,
  );
  if (legacyCategoryStatusPrefix) return [`${legacyCategoryStatusPrefix}.toggle-status`];

  const legacyPermissionPrefix = legacyScopedPermissionPrefixes.find((candidate) =>
    permission.startsWith(`${candidate}.`),
  );
  if (!legacyPermissionPrefix) return [permission];

  const suffix = permission.slice(legacyPermissionPrefix.length + 1);
  const action = legacyAttributeActionMap[suffix];
  if (!action) return [permission];

  return attributeScopes.map((scope) => `${legacyPermissionPrefix}.${scope}.${action}`);
};
